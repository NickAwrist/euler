import EulerAPI
import SwiftUI

/// Subagents and background jobs started at a transcript position, as compact cards.
struct TaskCards: View {
    let chat: ChatStore
    let position: Int
    @Binding var sheet: ChatSheet?

    var body: some View {
        let agents = chat.subagents.filter { Int($0.spawnPosition) == position }
        let jobs = chat.jobs.filter { $0.hasSpawnPosition && Int($0.spawnPosition) == position }
        if !agents.isEmpty || !jobs.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(agents, id: \.id) { agent in
                    AgentCard(chat: chat, agent: agent) { sheet = .agent(agent.id) }
                }
                ForEach(jobs, id: \.id) { job in
                    JobCard(chat: chat, job: job) { sheet = .job(job.id) }
                }
            }
            .padding(.vertical, 6)
        }
    }
}

struct AgentCard: View {
    let chat: ChatStore
    let agent: Euler_V1_Agent
    var showsActivity = false
    let open: () -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 4) {
            Button(action: open) {
                HStack(spacing: 10) {
                    AgentAvatar(agent: agent)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(agent.title).lineLimit(1)
                        Text(session.models.model(agent.model)?.name ?? agent.model)
                            .font(.caption)
                            .foregroundStyle(palette.muted)
                            .lineLimit(1)
                        if showsActivity, !agent.activity.isEmpty {
                            Text(agent.activity).font(.caption).foregroundStyle(palette.muted).lineLimit(1)
                        }
                    }
                    Spacer(minLength: 4)
                    AgentStatusLabel(agent: agent, phase: chat.phases[agent.id])
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(palette.muted)
                }
                .padding(.vertical, 8)
                .padding(.leading, 12)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if !agent.isFinal {
                Button(agent.isWorking ? "Stop \(agent.title)" : "Dismiss \(agent.title)", systemImage: agent.isWorking ? "stop.fill" : "xmark") {
                    Task { await session.notices.attempt { try await chat.cancelAgent(agent) } }
                }
                .labelStyle(.iconOnly)
                .font(.caption)
                .foregroundStyle(agent.isWorking ? .red : palette.muted)
                .frame(width: 36, height: 36)
                .buttonStyle(.plain)
            }
        }
        .font(.subheadline)
        .foregroundStyle(agent.isFinal ? palette.muted : palette.foreground)
        .padding(.trailing, 4)
        .background(palette.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.borderSubtle))
    }
}

/// A subagent's initial on a tinted circle.
struct AgentAvatar: View {
    let agent: Euler_V1_Agent

    var body: some View {
        let hue = Double(abs(agent.id.hashValue % 360)) / 360
        Text(String(agent.title.prefix(1)).uppercased())
            .font(.caption.weight(.semibold))
            .frame(width: 24, height: 24)
            .background(Color(hue: hue, saturation: 0.35, brightness: 0.45), in: .circle)
            .foregroundStyle(.white)
            .accessibilityHidden(true)
    }
}

struct AgentStatusLabel: View {
    let agent: Euler_V1_Agent
    let phase: AgentPhase?
    @Environment(\.palette) private var palette

    var body: some View {
        Text(label)
            .font(.caption)
            .foregroundStyle(agent.isWorking ? .green : palette.muted)
    }

    private var label: String {
        switch agent.status {
        case .queued: "Queued"
        case .running:
            switch phase {
            case .tool: "Using tools"
            case .responding: "Writing"
            case .thinking: "Thinking"
            case nil: "Working"
            }
        case .waiting: "Waiting"
        case .idle: "Ready"
        case .completed: "Done"
        case .cancelled: "Stopped"
        default: ""
        }
    }
}

struct JobCard: View {
    let chat: ChatStore
    let job: Euler_V1_Job
    let open: () -> Void
    @Environment(AppSession.self) private var session
    @Environment(\.palette) private var palette

    var body: some View {
        HStack(spacing: 4) {
            Button(action: open) {
                HStack(spacing: 10) {
                    if job.isActive {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "waveform.path.ecg").foregroundStyle(palette.muted)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(job.tool) · \(job.statusLabel)").font(.caption)
                        Text(job.description_p)
                            .font(.caption.monospaced())
                            .foregroundStyle(palette.muted)
                            .lineLimit(1)
                        JobElapsed(job: job)
                    }
                    Spacer(minLength: 4)
                    Image(systemName: "chevron.right").font(.caption2).foregroundStyle(palette.muted)
                }
                .padding(.vertical, 8)
                .padding(.leading, 12)
                .contentShape(.rect)
            }
            .buttonStyle(.plain)
            if job.isActive {
                Button("Cancel job") {
                    Task { await session.notices.attempt { try await chat.cancelJob(job) } }
                }
                .font(.caption)
                .buttonStyle(.borderless)
                .padding(.trailing, 8)
            }
        }
        .foregroundStyle(palette.foreground)
        .background(palette.surface, in: .rect(cornerRadius: 12))
        .overlay(RoundedRectangle(cornerRadius: 12).stroke(palette.borderSubtle))
    }
}

/// "Running for 12s" or "Ran for 59s", ticking while the job runs.
struct JobElapsed: View {
    let job: Euler_V1_Job
    @Environment(\.palette) private var palette

    var body: some View {
        TimelineView(.periodic(from: .now, by: 1)) { context in
            let end = job.hasEndedAt ? job.endedAt.date : context.date
            let seconds = Int(max(0, end.timeIntervalSince(job.createdAt.date)))
            let elapsed = seconds < 60 ? "\(seconds)s" : "\(seconds / 60)m \(seconds % 60)s"
            Text("\(job.hasEndedAt ? "Ran for" : "Running for") \(elapsed)")
                .font(.caption)
                .foregroundStyle(palette.muted)
        }
    }
}

extension Euler_V1_Job {
    var statusLabel: String {
        switch status {
        case .starting: "starting"
        case .running: "running"
        case .succeeded: "succeeded"
        case .failed: "failed"
        case .cancelled: "cancelled"
        case .interrupted: "interrupted"
        default: ""
        }
    }
}
