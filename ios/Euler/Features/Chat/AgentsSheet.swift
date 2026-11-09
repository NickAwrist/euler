import EulerAPI
import SwiftUI

/// The chat's subagents and background jobs, with their status and Cancel.
struct AgentsSheet: View {
    let chat: ChatStore
    @Environment(\.dismiss) private var dismiss
    @Environment(\.palette) private var palette

    var body: some View {
        NavigationStack {
            List {
                Section("Agents") {
                    if chat.subagents.isEmpty {
                        Text("No background agents in this chat.").foregroundStyle(palette.muted)
                    }
                    ForEach(chat.subagents, id: \.id) { agent in
                        NavigationLink {
                            AgentDetailView(chat: chat, agentID: agent.id)
                        } label: {
                            HStack(spacing: 10) {
                                AgentAvatar(agent: agent)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(agent.title).lineLimit(1)
                                    if !agent.activity.isEmpty {
                                        Text(agent.activity).font(.caption).foregroundStyle(palette.muted).lineLimit(1)
                                    }
                                }
                                Spacer()
                                AgentStatusLabel(agent: agent, phase: chat.phases[agent.id])
                            }
                        }
                    }
                }
                Section("Jobs") {
                    if chat.jobs.isEmpty {
                        Text("No background jobs in this chat.").foregroundStyle(palette.muted)
                    }
                    ForEach(chat.jobs, id: \.id) { job in
                        NavigationLink {
                            JobDetailView(chat: chat, jobID: job.id)
                        } label: {
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(job.tool) · \(job.statusLabel)")
                                Text(job.description_p).font(.caption.monospaced()).foregroundStyle(palette.muted).lineLimit(1)
                                JobElapsed(job: job)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Agents and jobs")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button("Done") { dismiss() } } }
            .refreshable {
                await chat.refresh()
                await chat.reloadJobs()
            }
        }
        .task { await chat.reloadJobs() }
    }
}

/// One subagent: its status, inbox and the steps it took.
struct AgentDetailView: View {
    let chat: ChatStore
    let agentID: String
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var detail: Euler_V1_GetAgentResponse?
    @State private var error: String?

    var body: some View {
        let agent = chat.agent(agentID) ?? detail?.agent
        List {
            if let agent {
                Section {
                    LabeledContent("Status") { AgentStatusLabel(agent: agent, phase: chat.phases[agent.id]) }
                    LabeledContent("Model", value: session.models.model(agent.model)?.name ?? agent.model)
                    if !agent.activity.isEmpty { Text(agent.activity).foregroundStyle(palette.muted) }
                    if agent.hasInterruption { Text(agent.interruption).foregroundStyle(.red) }
                    if !agent.isFinal {
                        Button(agent.isWorking ? "Stop agent" : "Dismiss agent", role: .destructive) {
                            Task { await session.notices.attempt { try await chat.cancelAgent(agent) } }
                        }
                    }
                }
            }
            if let detail {
                if !detail.messages.isEmpty {
                    Section("Messages") {
                        ForEach(detail.messages, id: \.id) { message in
                            VStack(alignment: .leading, spacing: 4) {
                                Text(message.sender).font(.caption).foregroundStyle(palette.muted)
                                MarkdownView(source: message.content)
                            }
                        }
                    }
                }
                let steps = TraceView.displayed(detail.steps)
                if !steps.isEmpty {
                    Section("Trace") { TraceSteps(steps: steps) }
                }
            } else if let error {
                Text(error).foregroundStyle(.red)
            } else {
                ProgressView()
            }
        }
        .navigationTitle(agent?.title ?? "Agent")
        .navigationBarTitleDisplayMode(.inline)
        // A working agent's trace grows, so it reloads while open.
        .task(id: agent?.status) {
            do {
                detail = try await chat.agentDetail(agentID)
            } catch {
                self.error = error.displayMessage
            }
        }
        .refreshable { detail = try? await chat.agentDetail(agentID) }
    }
}

/// One background job: its input, progress, output and result.
struct JobDetailView: View {
    let chat: ChatStore
    let jobID: String
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette
    @State private var job: Euler_V1_Job?

    var body: some View {
        List {
            if let job {
                Section {
                    LabeledContent("Status", value: job.statusLabel)
                    JobElapsed(job: job)
                    if job.isActive {
                        Button("Cancel job", role: .destructive) {
                            Task { await session.notices.attempt { try await chat.cancelJob(job) } }
                        }
                    }
                }
                ToolContentSection(title: "Input", content: job.input)
                if job.hasProgress { ToolContentSection(title: "Progress", content: job.progress) }
                if job.hasOutput { ToolContentSection(title: job.outputTruncated ? "Output (truncated)" : "Output", content: job.output) }
                if job.hasResult, !job.result.text.isEmpty {
                    Section("Result") {
                        Text(job.result.text).font(.footnote.monospaced()).textSelection(.enabled)
                    }
                }
                if job.hasError {
                    Section("Error") { Text(job.error.message).foregroundStyle(.red) }
                }
            } else {
                ProgressView()
            }
        }
        .navigationTitle(job.map { "\($0.tool) job" } ?? "Job")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: chat.jobs.first { $0.id == jobID }?.status) { await load() }
        .refreshable { await load() }
    }

    private func load() async {
        var request = Euler_V1_GetJobRequest()
        request.sessionID = chat.id
        request.jobID = jobID
        if let response = try? await session.backend.jobs.getJob(request: request, headers: [:]).value() {
            job = response.job
        }
    }
}

/// A job's input or output blocks: text, code, or labeled fields.
private struct ToolContentSection: View {
    let title: String
    let content: Euler_V1_ToolContent

    var body: some View {
        if !content.blocks.isEmpty {
            Section(title) {
                ForEach(content.blocks.indices, id: \.self) { index in
                    switch content.blocks[index].kind {
                    case .text(let text):
                        VStack(alignment: .leading) {
                            if text.hasLabel { Text(text.label).font(.caption).foregroundStyle(.secondary) }
                            Text(text.text).textSelection(.enabled)
                        }
                    case .code(let code):
                        VStack(alignment: .leading) {
                            if code.hasLabel { Text(code.label).font(.caption).foregroundStyle(.secondary) }
                            ScrollView(.horizontal) {
                                Text(code.text).font(.footnote.monospaced()).textSelection(.enabled)
                            }
                        }
                    case .fields(let fields):
                        ForEach(fields.fields, id: \.label) { field in
                            LabeledContent(field.label, value: field.value)
                        }
                    case nil:
                        EmptyView()
                    }
                }
            }
        }
    }
}
