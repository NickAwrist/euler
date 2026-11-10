import EulerAPI
import SwiftUI

/// Customization › Skills: the user's skills, an editor, and import from a pasted SKILL.md.
struct SkillsView: View {
    @Environment(AppSession.self) private var session
    @State private var skills: [Euler_V1_Skill]?
    @State private var editing: SkillEditorTarget?
    @State private var importing = false

    var body: some View {
        ThemedList {
            if let skills {
                if skills.isEmpty { Text("No skills yet.").foregroundStyle(.secondary) }
                ForEach(skills, id: \.id) { skill in
                    Button {
                        editing = .existing(skill)
                    } label: {
                        SkillRow(skill: skill)
                    }
                    .buttonStyle(.plain)
                }
                .onDelete { offsets in
                    for index in offsets { Task { await delete(skills[index]) } }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle("Skills")
        .toolbar {
            ToolbarItem(placement: .topBarTrailing) {
                Menu("Add", systemImage: "plus") {
                    Button("New", systemImage: "square.and.pencil", action: Haptics.selecting { editing = .new(SkillFields()) })
                    Button("Import SKILL.md", systemImage: "doc.on.clipboard", action: Haptics.selecting { importing = true })
                }
            }
        }
        .sheet(item: $editing) { target in
            SkillEditor(target: target) { await load() }
        }
        .sheet(isPresented: $importing) {
            ImportSkillSheet { fields in
                importing = false
                editing = .new(fields)
            }
        }
        .task { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        do {
            skills = try await session.backend.skills.listSkills(request: .init(), headers: [:]).value().skills
        } catch {
            session.notices.failure(error)
            skills = skills ?? []
        }
        await session.completions.reload()
    }

    private func delete(_ skill: Euler_V1_Skill) async {
        var request = Euler_V1_DeleteSkillRequest()
        request.id = skill.id
        if await session.notices.attempt({ _ = try await session.backend.skills.deleteSkill(request: request, headers: [:]).value() }) {
            Haptics.firm()
            await load()
        }
    }
}

/// A skill as a title and what it is for, with how it is invoked when that
/// isn't the default of both by people and by agents.
private struct SkillRow: View {
    let skill: Euler_V1_Skill
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 8) {
                    Text("\(Text("$").foregroundStyle(palette.muted))\(skill.name)")
                        .font(.body.weight(.medium))
                        .foregroundStyle(palette.foreground)
                        .lineLimit(1)
                    if let invocation {
                        Text(invocation)
                            .font(.caption2.weight(.medium))
                            .foregroundStyle(palette.muted)
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(palette.fill, in: .capsule)
                            .overlay(Capsule().stroke(palette.borderSubtle))
                            .fixedSize()
                    }
                }
                Text(skill.description_p)
                    .font(.footnote)
                    .foregroundStyle(palette.muted)
                    .lineLimit(2)
            }
            Spacer(minLength: 0)
            RowChevron()
        }
        .padding(.vertical, 2)
        .contentShape(.rect)
    }

    private var invocation: String? {
        switch (skill.userInvocable, !skill.disableModelInvocation) {
        case (true, true): nil
        case (true, false): "Manual"
        case (false, true): "Agents only"
        case (false, false): "Off"
        }
    }
}

enum SkillEditorTarget: Identifiable {
    case new(SkillFields)
    case existing(Euler_V1_Skill)

    var id: String {
        switch self {
        case .new: "new"
        case .existing(let skill): skill.id
        }
    }
}

/// A skill's editable fields, as the editor and SKILL.md import fill them.
struct SkillFields: Equatable {
    var name = ""
    var description = ""
    var instructions = ""
    var userInvocable = true
    var disableModelInvocation = false

    init() {}

    init(_ skill: Euler_V1_Skill) {
        name = skill.name
        description = skill.description_p
        instructions = skill.instructions
        userInvocable = skill.userInvocable
        disableModelInvocation = skill.disableModelInvocation
    }

    var message: Euler_V1_SkillFields {
        var fields = Euler_V1_SkillFields()
        fields.name = name
        fields.description_p = description
        fields.instructions = instructions
        fields.userInvocable = userInvocable
        fields.disableModelInvocation = disableModelInvocation
        return fields
    }

    /// What keeps each field from saving, in the server's words (proto/euler/v1/skills.proto).
    struct Problems: Equatable {
        var name: String?
        var description: String?
        var instructions: String?

        var isEmpty: Bool { name == nil && description == nil && instructions == nil }
    }

    var problems: Problems {
        var problems = Problems()
        if name.isEmpty {
            problems.name = "Name is required"
        } else if name.count > 64 {
            problems.name = "Name must be 64 characters or fewer"
        }
        let description = description.trimmingCharacters(in: .whitespacesAndNewlines)
        if description.isEmpty {
            problems.description = "Description is required"
        } else if description.count > 500 {
            problems.description = "Description must be 500 characters or fewer"
        }
        if instructions.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            problems.instructions = "Instructions are required"
        }
        return problems
    }

    /// Lowercase letters, numbers and single hyphens, as the server requires.
    static func normalizedName(_ value: String) -> String {
        var name = value.lowercased()
            .replacing(/[\s_]+/, with: "-")
            .replacing(/[^a-z0-9-]/, with: "")
            .replacing(/-{2,}/, with: "-")
        if name.hasPrefix("-") { name.removeFirst() }
        return name
    }

    /// Reads a pasted SKILL.md as the web does (skillsPageUtils.ts): flat
    /// `key: value` frontmatter with indented continuations, and the body as
    /// instructions. Text without frontmatter is all instructions.
    static func parse(_ markdown: String) -> SkillFields {
        var fields = SkillFields()
        var body = markdown
        var values: [String: String] = [:]
        if let match = markdown.wholeMatch(of: /---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)([\s\S]*)/) {
            body = String(match.output.2)
            var key = ""
            for line in match.output.1.split(separator: /\r?\n/, omittingEmptySubsequences: false) {
                if let entry = line.wholeMatch(of: /([\w-]+):[ \t]*(.*)/) {
                    key = String(entry.output.1)
                    let value = String(entry.output.2)
                    if value.wholeMatch(of: /[|>][+-]?/) != nil {
                        values[key] = ""
                    } else {
                        let trimmed = value.trimmingCharacters(in: .whitespaces)
                        values[key] = trimmed.wholeMatch(of: /(["'])(.*)\1/).map { String($0.output.2) } ?? trimmed
                    }
                } else if !key.isEmpty, line.first?.isWhitespace == true, line.contains(where: { !$0.isWhitespace }) {
                    values[key] = "\(values[key] ?? "") \(line.trimmingCharacters(in: .whitespaces))".trimmingCharacters(in: .whitespaces)
                }
            }
        }
        var name = normalizedName(values["name"] ?? "")
        while name.hasSuffix("-") { name.removeLast() }
        fields.name = name
        fields.description = values["description"] ?? ""
        fields.instructions = body.trimmingCharacters(in: .whitespacesAndNewlines)
        fields.userInvocable = values["user-invocable"] != "false"
        fields.disableModelInvocation = values["disable-model-invocation"] == "true"
        return fields
    }
}

private struct SkillEditor: View {
    let target: SkillEditorTarget
    let saved: () async -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var fields = SkillFields()
    @State private var original = SkillFields()
    @State private var saving = false
    @State private var confirmingDiscard = false
    /// Set by a Save that found problems; from then they show beside their fields.
    @State private var showsProblems = false

    var body: some View {
        let problems = showsProblems ? fields.problems : SkillFields.Problems()
        NavigationStack {
            ThemedForm {
                Section {
                    TextField("release-notes", text: $fields.name)
                        .font(.body.monospaced())
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .onChange(of: fields.name) { _, name in fields.name = SkillFields.normalizedName(name) }
                        .accessibilityLabel("Name")
                    TextField("Description", text: $fields.description, axis: .vertical)
                } header: {
                    Text("Skill")
                } footer: {
                    problemText([problems.name, problems.description])
                }
                Section {
                    TextEditor(text: $fields.instructions)
                        .font(.footnote.monospaced())
                        .frame(minHeight: 240)
                        .accessibilityLabel("Instructions")
                } header: {
                    Text("Instructions")
                } footer: {
                    problemText([problems.instructions])
                }
                Section {
                    Toggle("Users can invoke", isOn: $fields.userInvocable)
                    Toggle("Agents can load automatically", isOn: Binding(
                        get: { !fields.disableModelInvocation },
                        set: { fields.disableModelInvocation = !$0 }
                    ))
                }
            }
            .navigationTitle(isNew ? "New skill" : "$\(original.name)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                CloseToolbarItem(label: "Cancel", placement: .cancellationAction) {
                    if fields != original { confirmingDiscard = true } else { dismiss() }
                }
                ToolbarItem(placement: .confirmationAction) {
                    // Stays enabled with fields missing, so tapping it can say which.
                    Button("Save") { Task { await save() } }
                        .disabled(saving || (!isNew && fields == original))
                }
            }
            .confirmationDialog("Discard changes?", isPresented: $confirmingDiscard) {
                Button("Discard changes", role: .destructive) { dismiss() }
            }
        }
        .interactiveDismissDisabled(fields != original)
        .onAppear {
            switch target {
            case .new(let initial):
                fields = initial
                original = SkillFields()
            case .existing(let skill):
                fields = SkillFields(skill)
                original = fields
            }
        }
    }

    private var isNew: Bool {
        if case .new = target { return true }
        return false
    }

    @ViewBuilder
    private func problemText(_ problems: [String?]) -> some View {
        let problems = problems.compactMap(\.self)
        if !problems.isEmpty {
            Text(problems.joined(separator: "\n")).foregroundStyle(.red)
        }
    }

    private func save() async {
        // The server rejects a name that ends in a hyphen, which typing "a-b" passes through.
        while fields.name.hasSuffix("-") { fields.name.removeLast() }
        guard fields.problems.isEmpty else {
            withAnimation(.snappy) { showsProblems = true }
            Haptics.failure()
            return
        }
        saving = true
        defer { saving = false }
        let skills = session.backend.skills
        let ok = await session.notices.attempt {
            switch target {
            case .new:
                var request = Euler_V1_CreateSkillRequest()
                request.skill = fields.message
                _ = try await skills.createSkill(request: request, headers: [:]).value()
            case .existing(let skill):
                var request = Euler_V1_UpdateSkillRequest()
                request.id = skill.id
                request.skill = fields.message
                _ = try await skills.updateSkill(request: request, headers: [:]).value()
            }
        }
        if ok {
            Haptics.success()
            await saved()
            dismiss()
        }
    }
}

private struct ImportSkillSheet: View {
    let imported: (SkillFields) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var text = ""

    var body: some View {
        NavigationStack {
            ThemedForm {
                TextEditor(text: $text)
                    .font(.footnote.monospaced())
                    .frame(minHeight: 300)
                    .accessibilityLabel("SKILL.md")
                PasteTextButton { text = $0 }
            }
            .navigationTitle("Import SKILL.md")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                CloseToolbarItem(label: "Cancel", placement: .cancellationAction) { dismiss() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Import") { imported(SkillFields.parse(text)) }
                        .disabled(text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }
}
