import { useState } from "react";
import { useMobileLayout } from "../../hooks/useMobileLayout";
import { TruncateConfirmModal } from "../TruncateConfirmModal";
import { ImportSkillModal } from "./ImportSkillModal";
import { SkillEditor } from "./SkillEditor";
import { SkillList } from "./SkillList";
import { useSkillsPage } from "./useSkillsPage";

export function SkillsTab() {
  const p = useSkillsPage();
  const [importOpen, setImportOpen] = useState(false);
  // Mobile shows the list or the open skill, not both.
  const mobile = useMobileLayout();

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {p.error && (
        <div className="shrink-0 border-b border-red-400/20 bg-red-400/5 px-5 py-2.5 text-[0.8125rem] text-red-400">
          {p.error}
        </div>
      )}
      <div
        className={
          mobile
            ? "flex min-h-0 flex-1 flex-col"
            : "grid min-h-0 flex-1 grid-cols-[280px_minmax(0,1fr)]"
        }
      >
        {!(mobile && p.showEditor) && (
          <SkillList
            skills={p.skills}
            selectedId={p.selectedId}
            isNew={p.isNew}
            onSelectSkill={p.selectSkill}
            onStartNew={p.startNew}
            onImport={() => setImportOpen(true)}
          />
        )}
        {!(mobile && !p.showEditor) && (
          <div className="min-h-0 flex-1 overflow-y-auto">
            {p.showEditor ? (
              <SkillEditor
                isNew={p.isNew}
                skill={p.selectedSkill}
                editor={p.editor}
                setEditor={p.setEditor}
                errors={p.fieldErrors}
                saving={p.saving}
                deleting={p.deleting}
                saveDisabled={!p.editorDirty || p.saving}
                onSave={() => void p.save()}
                onCancel={p.cancelEdit}
                onDelete={p.setPendingDelete}
                onBack={mobile ? p.cancelEdit : undefined}
              />
            ) : (
              <div className="flex h-full items-center justify-center px-6 text-center">
                <p className="text-[0.875rem] text-muted-foreground">
                  Select a skill or create a new one
                </p>
              </div>
            )}
          </div>
        )}
      </div>

      {importOpen && (
        <ImportSkillModal
          onImport={(skill) => {
            p.importSkill(skill);
            setImportOpen(false);
          }}
          onClose={() => setImportOpen(false)}
        />
      )}

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
