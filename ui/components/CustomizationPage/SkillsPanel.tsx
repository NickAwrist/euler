import { TruncateConfirmModal } from "../TruncateConfirmModal";
import { SkillEditor } from "./SkillEditor";
import { SkillList } from "./SkillList";
import { useSkillsPage } from "./useSkillsPage";

export function SkillsPanel() {
  const p = useSkillsPage();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {p.error && (
        <div className="shrink-0 border-b border-red-400/20 bg-red-400/5 px-5 py-2.5 text-[0.8125rem] text-red-400">
          {p.error}
        </div>
      )}
      <div className="grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)] max-[700px]:grid-cols-1">
        <SkillList
          skills={p.skills}
          selectedId={p.selectedId}
          isNew={p.isNew}
          onSelectSkill={p.selectSkill}
          onStartNew={p.startNew}
        />
        <div className="min-h-0 overflow-y-auto">
          {p.showEditor ? (
            <SkillEditor
              isNew={p.isNew}
              skill={p.selectedSkill}
              editor={p.editor}
              setEditor={p.setEditor}
              saving={p.saving}
              deleting={p.deleting}
              saveDisabled={!p.editorDirty || p.saving}
              onSave={() => void p.save()}
              onCancel={p.cancelEdit}
              onDelete={p.setPendingDelete}
            />
          ) : (
            <div className="flex h-full items-center justify-center px-6 text-center">
              <p className="text-[0.875rem] text-muted-foreground">
                Select a skill or create a new one
              </p>
            </div>
          )}
        </div>
      </div>

      {p.pendingDelete && (
        <TruncateConfirmModal
          title="Delete this skill?"
          description={`Remove "$${p.pendingDelete.name}" from your skills. Agents will no longer be able to load it. This cannot be undone.`}
          confirmLabel="Delete"
          busyConfirmLabel="Deleting..."
          busy={p.deleting}
          onClose={() => p.setPendingDelete(null)}
          onConfirm={() => void p.performDelete()}
        />
      )}
    </div>
  );
}
