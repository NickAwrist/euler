import EulerAPI
import SwiftUI

/// The web's model picker as a sheet: a rail of providers with Favorites first,
/// and the chosen provider's models, searchable, with their details and stars.
struct ModelPickerSheet: View {
    let selected: String?
    let pick: (Euler_V1_Model) -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @Environment(\.dismiss) private var dismiss
    @Environment(\.openSettings) private var openSettings
    @State private var providerID: String?
    @State private var search = ""
    @State private var favoriteError: String?
    /// Each model's place when the picker opened, so a starred row stays under the finger.
    @State private var openingOrder: [String: Int]?
    /// Stars with a save in flight, which ignore taps until it settles, as on the web.
    @State private var pendingFavorites: Set<String> = []

    var body: some View {
        let groups = ModelProviderGroup.groups(session.models.models).map { group in
            guard let openingOrder else { return group }
            var ordered = group
            ordered.models.sort { (openingOrder[$0.id] ?? .max) < (openingOrder[$1.id] ?? .max) }
            return ordered
        }
        let current = groups.first { $0.id == providerID } ?? groups.first { $0.id == selectedGroupID(groups) } ?? groups[0]
        let query = search.trimmingCharacters(in: .whitespaces).lowercased()
        let models = current.models.filter {
            query.isEmpty || "\($0.name) \($0.hasRoute ? $0.route : $0.id)".lowercased().contains(query)
        }
        HStack(spacing: 0) {
            rail(groups, current: current)
            Rectangle().fill(palette.borderSubtle).frame(width: 1).ignoresSafeArea()
            VStack(spacing: 0) {
                searchField(current)
                Rectangle().fill(palette.borderSubtle).frame(height: 1)
                HStack {
                    Text(current.name)
                    Spacer()
                    Text("\(models.count)").monospacedDigit()
                }
                .font(.caption)
                .foregroundStyle(palette.muted)
                .padding(.horizontal, 14)
                .padding(.top, 12)
                .padding(.bottom, 4)
                ScrollView {
                    LazyVStack(spacing: 2) {
                        if let favoriteError {
                            Text(favoriteError).font(.footnote).foregroundStyle(.red).padding(10)
                        }
                        ForEach(models, id: \.id) { model in
                            ModelPickerRow(model: model, selected: model.id == selected, saving: pendingFavorites.contains(model.id)) {
                                pick(model)
                                Haptics.light()
                                dismiss()
                            } toggleFavorite: {
                                Task { await toggleFavorite(model) }
                            }
                        }
                        if models.isEmpty {
                            Text(empty(current))
                                .font(.subheadline)
                                .foregroundStyle(palette.muted)
                                .multilineTextAlignment(.center)
                                .padding(.vertical, 24)
                                .padding(.horizontal, 10)
                        }
                        Button {
                            dismiss()
                            openSettings(.openRouter)
                        } label: {
                            Text("Choose models")
                                .font(.subheadline)
                                .foregroundStyle(palette.muted)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .padding(.horizontal, 10)
                                .padding(.vertical, 10)
                                .contentShape(.rect)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(6)
                }
                .scrollDismissesKeyboard(.immediately)
            }
        }
        .padding(.top, 8)
        .background(palette.surface)
        .presentationBackground(palette.surface)
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
        .presentationCornerRadius(24)
        .onAppear {
            guard openingOrder == nil else { return }
            // Favorites first, then each provider's order, as the lists show them now.
            let ordered = ModelProviderGroup.groups(session.models.models).flatMap(\.models)
            var order: [String: Int] = [:]
            for (index, model) in ordered.enumerated() where order[model.id] == nil { order[model.id] = index }
            openingOrder = order
        }
    }

    private func selectedGroupID(_ groups: [ModelProviderGroup]) -> String {
        groups.dropFirst().first { group in group.models.contains { $0.id == selected } }?.id ?? ModelProviderGroup.favoritesID
    }

    private func empty(_ group: ModelProviderGroup) -> String {
        if !search.isEmpty { return "No matching models" }
        if group.id == ModelProviderGroup.favoritesID { return "Favorite enabled models to find them here." }
        return session.models.error ?? "No models found"
    }

    private func rail(_ groups: [ModelProviderGroup], current: ModelProviderGroup) -> some View {
        ScrollView(showsIndicators: false) {
            VStack(spacing: 4) {
                ForEach(groups) { group in
                    Button {
                        providerID = group.id
                        search = ""
                    } label: {
                        Group {
                            if group.id == ModelProviderGroup.favoritesID {
                                Image(systemName: "star.fill").font(.system(size: 18)).foregroundStyle(Palette.favorite)
                            } else {
                                ProviderIcon(icon: group.icon, name: group.name, size: 22)
                            }
                        }
                        .frame(width: 46, height: 46)
                        .background(group.id == current.id ? palette.fill : .clear, in: .rect(cornerRadius: 12))
                        .overlay {
                            if group.id == current.id {
                                RoundedRectangle(cornerRadius: 12).stroke(palette.border, lineWidth: 1)
                            }
                        }
                        .contentShape(.rect)
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(group.name)
                    .accessibilityAddTraits(group.id == current.id ? .isSelected : [])
                }
            }
            .padding(7)
        }
        .frame(width: 60)
        .sensoryFeedback(.selection, trigger: providerID)
    }

    private func searchField(_ group: ModelProviderGroup) -> some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass").foregroundStyle(palette.muted)
            TextField("Search models...", text: $search)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .submitLabel(.done)
                .accessibilityLabel("Search \(group.name) models")
            if !search.isEmpty {
                Button("Clear search", systemImage: "xmark.circle.fill") { search = "" }
                    .labelStyle(.iconOnly)
                    .foregroundStyle(palette.muted)
            }
        }
        .font(.subheadline)
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
    }

    private func toggleFavorite(_ model: Euler_V1_Model) async {
        guard pendingFavorites.insert(model.id).inserted else { return }
        defer { pendingFavorites.remove(model.id) }
        favoriteError = nil
        Haptics.light()
        do {
            try await session.models.setFavorite(model, !model.favorite)
        } catch {
            favoriteError = "Couldn't save favorite. Try again."
        }
    }
}

/// One model: name, New badge, details and capabilities, a check when selected, and its star.
private struct ModelPickerRow: View {
    let model: Euler_V1_Model
    let selected: Bool
    let saving: Bool
    let choose: () -> Void
    let toggleFavorite: () -> Void
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 2) {
            Button(action: choose) {
                HStack(spacing: 10) {
                    VStack(alignment: .leading, spacing: 3) {
                        HStack(spacing: 6) {
                            Text(model.name)
                                .font(.subheadline.weight(.medium))
                                .foregroundStyle(palette.foreground)
                                .lineLimit(1)
                            if model.isNew { NewBadge() }
                        }
                        HStack(spacing: 6) {
                            let details = model.pickerDetails
                            if !details.isEmpty { Text(details).lineLimit(1) }
                            ForEach(model.capabilities, id: \.label) { capability in
                                Image(systemName: capability.symbol)
                                    .font(.system(size: 10))
                                    .accessibilityLabel(capability.label)
                            }
                        }
                        .font(.caption)
                        .foregroundStyle(palette.muted)
                    }
                    Spacer(minLength: 0)
                    if selected {
                        Image(systemName: "checkmark")
                            .font(.footnote.weight(.semibold))
                            .foregroundStyle(palette.tint)
                    }
                }
                .padding(.horizontal, 10)
                .padding(.vertical, 8)
                .frame(minHeight: 50)
                .background(selected ? palette.fill : .clear, in: .rect(cornerRadius: 10))
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(model.needsSetup)
            .opacity(model.needsSetup ? 0.4 : 1)
            .accessibilityAddTraits(selected ? .isSelected : [])
            Button(action: toggleFavorite) {
                Image(systemName: model.favorite ? "star.fill" : "star")
                    .font(.system(size: 16))
                    .foregroundStyle(model.favorite ? Palette.favorite : palette.muted)
                    .scaleEffect(model.favorite ? 1.1 : 1)
                    .frame(width: 40, height: 40)
                    .contentShape(.rect)
            }
            .buttonStyle(.plain)
            .disabled(saving)
            .animation(.snappy(duration: 0.2), value: model.favorite)
            .accessibilityLabel("\(model.favorite ? "Unfavorite" : "Favorite") \(model.name)")
        }
    }
}

/// Marks a model OpenRouter added recently.
struct NewBadge: View {
    @Environment(\.palette) private var palette

    var body: some View {
        Text("New")
            .font(.system(size: 10, weight: .medium))
            .foregroundStyle(Palette.favorite)
            .padding(.horizontal, 5)
            .padding(.vertical, 2)
            .background(palette.background, in: .rect(cornerRadius: 4))
            .overlay(RoundedRectangle(cornerRadius: 4).stroke(Palette.favorite.opacity(0.25)))
    }
}
