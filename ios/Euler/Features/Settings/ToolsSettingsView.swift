import EulerAPI
import SwiftProtobuf
import SwiftUI

/// Customization › Tools: built-in capabilities, MCP servers and tool permission rules.
struct ToolsSettingsView: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        ThemedForm {
            CapabilitiesSection()
            McpServersSection()
            PermissionRulesSection()
        }
        .navigationTitle("Tools")
    }
}

private struct CapabilitiesSection: View {
    @Environment(AppSession.self) private var session

    var body: some View {
        let capabilities = session.preferences.preferences.capabilities
        Section("Built-in") {
            toggle("Web search", capabilities.web) { $0.web = $1 }
            toggle("Image generation", capabilities.imageGeneration) { $0.imageGeneration = $1 }
            toggle("Shell", capabilities.shell) { $0.shell = $1 }
            toggle("Files", capabilities.files) { $0.files = $1 }
            toggle("Skill management", capabilities.skills) { $0.skills = $1 }
        }
    }

    private func toggle(_ title: String, _ value: Bool, set: @escaping (inout Euler_V1_UpdatePreferencesRequest.CapabilitiesPatch, Bool) -> Void) -> some View {
        Toggle(title, isOn: Binding(
            get: { value },
            set: { enabled in savePreferences(session) { set(&$0.capabilities, enabled) } }
        ))
    }
}

private struct McpServersSection: View {
    @Environment(AppSession.self) private var session
    @State private var servers: [Euler_V1_McpServer]?
    @State private var adding = false

    var body: some View {
        Section("MCP servers") {
            if let servers {
                if servers.isEmpty { Text("No MCP servers yet.").foregroundStyle(.secondary) }
                ForEach(servers, id: \.id) { server in
                    NavigationLink {
                        McpServerView(server: server) { await load() }
                    } label: {
                        VStack(alignment: .leading, spacing: 2) {
                            HStack {
                                Text(server.name)
                                if !server.enabled { Text("Off").font(.caption).foregroundStyle(.secondary) }
                            }
                            Text(server.url).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                        }
                    }
                }
            } else {
                ProgressView()
            }
            // The sheet hangs off one row: on the section it would be on every row, and
            // the rows' sheets opening together close Settings under them.
            Button("Add", systemImage: "plus") { adding = true }
                .sheet(isPresented: $adding) {
                    AddMcpServersSheet { await load() }
                }
                .task { await load() }
        }
    }

    private func load() async {
        servers = (try? await session.backend.mcpServers.listServers(request: .init(), headers: [:]).value().servers) ?? servers ?? []
        await session.completions.reload()
    }
}

private struct McpServerView: View {
    let server: Euler_V1_McpServer
    let changed: () async -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var enabled: Bool?
    @State private var check: Euler_V1_TestServerResponse.OneOf_Result?

    var body: some View {
        ThemedForm {
            Section {
                LabeledContent("URL", value: server.url)
                if !server.headerNames.isEmpty {
                    LabeledContent("Headers", value: server.headerNames.joined(separator: ", "))
                }
                Toggle("Enabled", isOn: Binding(
                    get: { enabled ?? server.enabled },
                    set: { value in Task { await setEnabled(value) } }
                ))
            }
            Section("Tools") {
                switch check {
                case .connected(let connected):
                    if connected.tools.isEmpty { Text("No tools.").foregroundStyle(.secondary) }
                    ForEach(connected.tools, id: \.name) { tool in
                        VStack(alignment: .leading, spacing: 2) {
                            Text(tool.name).font(.body.monospaced())
                            if !tool.description_p.isEmpty {
                                Text(tool.description_p).font(.caption).foregroundStyle(.secondary).lineLimit(3)
                            }
                        }
                    }
                case .error(let message):
                    Text(message).foregroundStyle(.red)
                case nil:
                    ProgressView()
                }
            }
            Section {
                Button("Delete", role: .destructive) { Task { await delete() } }
            }
        }
        .navigationTitle(server.name)
        .navigationBarTitleDisplayMode(.inline)
        .task { await test() }
        .refreshable { await test() }
    }

    private func test() async {
        var request = Euler_V1_TestServerRequest()
        request.id = server.id
        do {
            check = try await session.backend.mcpServers.testServer(request: request, headers: [:]).value().result
        } catch {
            check = .error(error.displayMessage)
        }
    }

    private func setEnabled(_ value: Bool) async {
        var request = Euler_V1_UpdateServerRequest()
        request.id = server.id
        request.enabled = value
        if await session.notices.attempt({ _ = try await session.backend.mcpServers.updateServer(request: request, headers: [:]).value() }) {
            enabled = value
            await changed()
        }
    }

    private func delete() async {
        var request = Euler_V1_DeleteServerRequest()
        request.id = server.id
        if await session.notices.attempt({ _ = try await session.backend.mcpServers.deleteServer(request: request, headers: [:]).value() }) {
            Haptics.firm()
            await changed()
            dismiss()
        }
    }
}

/// Paste an `mcpServers` config from an MCP server's docs.
private struct AddMcpServersSheet: View {
    let added: () async -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    @State private var config = ""
    @State private var error: String?
    @State private var saving = false

    var body: some View {
        NavigationStack {
            ThemedForm {
                Section {
                    TextEditor(text: $config)
                        .font(.footnote.monospaced())
                        .frame(minHeight: 220)
                        .autocorrectionDisabled()
                        .textInputAutocapitalization(.never)
                        .accessibilityLabel("MCP server config")
                    PasteTextButton { config = $0 }
                } footer: {
                    if let error { Text(error).foregroundStyle(.red) }
                }
            }
            .navigationTitle("Add MCP servers")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                CloseToolbarItem(label: "Cancel", placement: .cancellationAction) { dismiss() }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") { Task { await add() } }
                        .disabled(saving || config.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
                }
            }
        }
    }

    private func add() async {
        guard (try? JSONSerialization.jsonObject(with: Data(config.utf8))) != nil else {
            error = "Config is not valid JSON"
            return
        }
        saving = true
        defer { saving = false }
        var request = Euler_V1_CreateServersRequest()
        request.config = config
        do {
            _ = try await session.backend.mcpServers.createServers(request: request, headers: [:]).value()
            Haptics.success()
            await added()
            dismiss()
        } catch {
            self.error = error.displayMessage
        }
    }
}

private struct PermissionRulesSection: View {
    @Environment(AppSession.self) private var session
    @State private var editing: RuleEditorTarget?

    var body: some View {
        let rules = session.preferences.preferences.toolPermissionRules
        Section {
            if rules.isEmpty { Text("No rules.").foregroundStyle(.secondary) }
            ForEach(rules, id: \.id) { rule in
                Button { editing = RuleEditorTarget(rule: rule) } label: { RuleSummary(rule: rule) }
                    .foregroundStyle(.primary)
            }
            .onDelete { offsets in
                for index in offsets { Task { await delete(rules[index]) } }
            }
            Button("Add rule", systemImage: "plus") { editing = RuleEditorTarget(rule: nil) }
                .sheet(item: $editing) { target in
                    RuleEditor(rule: target.rule)
                }
        } header: {
            Text("Tool permissions")
        } footer: {
            Text("The first matching rule decides; tool calls without a match ask.")
        }
    }

    private func delete(_ rule: Euler_V1_ToolPermissionRule) async {
        var request = Euler_V1_DeletePermissionRuleRequest()
        request.ruleID = rule.id
        await session.notices.attempt {
            session.preferences.adopt(try await session.preferences.client.deletePermissionRule(request: request, headers: [:]).value().preferences)
        }
    }
}

private struct RuleEditorTarget: Identifiable {
    let rule: Euler_V1_ToolPermissionRule?
    var id: String { rule?.id ?? "new" }
}

private struct RuleSummary: View {
    let rule: Euler_V1_ToolPermissionRule

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            Text("\(action) \(rule.tool == "*" ? "all tools" : rule.tool)")
            Text(condition).font(.caption).foregroundStyle(.secondary).lineLimit(2)
            if rule.hasSessionID {
                Text("Only in one chat and workspace" + (rule.hasWorkspacePath ? " \(rule.workspacePath)" : ""))
                    .font(.caption2).foregroundStyle(.secondary)
            }
        }
    }

    private var action: String {
        switch rule.action {
        case .allow: "Allow"
        case .deny: "Deny"
        default: "Ask before"
        }
    }

    private var condition: String {
        switch rule.condition.kind {
        case .argument(let argument):
            "\(argument.field) \(argument.match == .regex ? "matches" : "is") \(argument.value.displayText)"
        case .arguments(let arguments):
            "Exact arguments \(arguments.value.prettyJSON.replacingOccurrences(of: "\n", with: " "))"
        default:
            "Any call"
        }
    }
}

/// Adds or edits a rule. Autogenerated exact-argument rules are read-only so edits can't broaden them.
private struct RuleEditor: View {
    let rule: Euler_V1_ToolPermissionRule?
    @Environment(AppSession.self) private var session
    @Environment(\.dismiss) private var dismiss
    /// The tools a rule can name and the fields of each. The editor loads them itself:
    /// handed down from the page, a sheet kept the empty list it was first built with.
    @State private var tools: [Euler_V1_PermissionTool] = []
    @State private var tool = ""
    @State private var action: Euler_V1_ToolPermissionRule.Action = .ask
    @State private var matchField = false
    @State private var field = ""
    @State private var match: Euler_V1_ToolPermissionCondition.Argument.Match = .exact
    @State private var value = ""

    private var exact: Bool {
        if case .arguments = rule?.condition.kind { return true }
        return false
    }

    private var fields: [Euler_V1_PermissionField] {
        tools.first { $0.name == tool }?.fields ?? []
    }

    var body: some View {
        NavigationStack {
            ThemedForm {
                if exact, let rule {
                    Section("Exact arguments") {
                        Text(rule.condition.arguments.value.prettyJSON).font(.caption.monospaced())
                    }
                } else {
                    Section {
                        Picker("Tool", selection: $tool.ticking()) {
                            Text("All tools").tag("*")
                            ForEach(tools, id: \.name) { Text($0.name).tag($0.name) }
                            if !tool.isEmpty, tool != "*", !tools.contains(where: { $0.name == tool }) {
                                Text(tool).tag(tool)
                            }
                        }
                        .mutedPickerValue()
                        Picker("Action", selection: $action.ticking()) {
                            Text("Allow").tag(Euler_V1_ToolPermissionRule.Action.allow)
                            Text("Ask").tag(Euler_V1_ToolPermissionRule.Action.ask)
                            Text("Deny").tag(Euler_V1_ToolPermissionRule.Action.deny)
                        }
                        .mutedPickerValue()
                    }
                    Section {
                        Toggle("Match a field", isOn: $matchField)
                        if matchField {
                            Picker("Field", selection: $field.ticking()) {
                                Text("Field").tag("")
                                ForEach(fields, id: \.path) { Text($0.path).tag($0.path) }
                                if !field.isEmpty, !fields.contains(where: { $0.path == field }) { Text(field).tag(field) }
                            }
                            .mutedPickerValue()
                            Picker("Match", selection: $match.ticking()) {
                                Text("Exact").tag(Euler_V1_ToolPermissionCondition.Argument.Match.exact)
                                Text("Pattern").tag(Euler_V1_ToolPermissionCondition.Argument.Match.regex)
                            }
                            .pickerStyle(.segmented)
                            TextField(match == .regex ? "Pattern" : "Value", text: $value)
                                .font(.body.monospaced())
                                .textInputAutocapitalization(.never)
                                .autocorrectionDisabled()
                        }
                    }
                }
            }
            .navigationTitle(rule == nil ? "New rule" : "Rule for \(rule?.tool ?? "")")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                CloseToolbarItem(label: "Cancel", placement: .cancellationAction) { dismiss() }
                if !exact {
                    ToolbarItem(placement: .confirmationAction) {
                        Button("Save") { Task { await save() } }
                            .disabled(tool.isEmpty || (matchField && (field.isEmpty || value.isEmpty)))
                    }
                }
            }
        }
        .onAppear(perform: fill)
        .task {
            await session.notices.attempt {
                tools = try await session.preferences.client.listPermissionTools(request: .init(), headers: [:]).value().tools
            }
        }
    }

    private func fill() {
        guard let rule else {
            tool = "*"
            return
        }
        tool = rule.tool
        action = rule.action
        if case .argument(let argument) = rule.condition.kind {
            matchField = true
            field = argument.field
            match = argument.match
            value = argument.value.displayText
        }
    }

    private func save() async {
        var saved = rule ?? Euler_V1_ToolPermissionRule()
        if rule == nil { saved.id = UUID().uuidString.lowercased() }
        saved.tool = tool
        saved.action = action
        var condition = Euler_V1_ToolPermissionCondition()
        if matchField {
            var argument = Euler_V1_ToolPermissionCondition.Argument()
            argument.field = field
            argument.match = match
            argument.value = typedValue
            condition.kind = .argument(argument)
        } else {
            condition.kind = .any(.init())
        }
        saved.condition = condition
        var request = Euler_V1_PutPermissionRuleRequest()
        request.rule = saved
        let ok = await session.notices.attempt {
            session.preferences.adopt(try await session.preferences.client.putPermissionRule(request: request, headers: [:]).value().preferences)
        }
        if ok { dismiss() }
    }

    /// The value in the field's own type, so `true` matches a boolean and `3` a number.
    private var typedValue: Google_Protobuf_Value {
        guard match == .exact, let type = fields.first(where: { $0.path == field })?.type else {
            return Google_Protobuf_Value(stringValue: value)
        }
        switch type {
        case .number: return Double(value).map(Google_Protobuf_Value.init(numberValue:)) ?? Google_Protobuf_Value(stringValue: value)
        case .boolean: return ["true", "false"].contains(value) ? Google_Protobuf_Value(boolValue: value == "true") : Google_Protobuf_Value(stringValue: value)
        default: return Google_Protobuf_Value(stringValue: value)
        }
    }
}

extension Google_Protobuf_Value {
    /// The value as a person reads it: strings bare, everything else as JSON.
    var displayText: String {
        switch kind {
        case .stringValue(let text): text
        case .numberValue(let number): number.formatted()
        case .boolValue(let flag): flag ? "true" : "false"
        default: (try? jsonString()) ?? ""
        }
    }
}
