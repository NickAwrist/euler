import { useCallback, useEffect, useState } from "react";
import {
  type SkillData,
  type SkillWriteBody,
  createSkillApi,
  deleteSkillApi,
  fetchSkills,
  updateSkillApi,
} from "../../persist/skills";
import {
  editorFromSkill,
  emptySkillEditor,
  skillEditorsEqual,
} from "./skillsPageUtils";

export function useSkillsPage() {
  const [skills, setSkills] = useState<SkillData[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [editor, setEditor] = useState<SkillWriteBody>(emptySkillEditor);
  const [baseline, setBaseline] = useState<SkillWriteBody>(emptySkillEditor);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<SkillData | null>(null);

  const load = useCallback(async () => {
    try {
      setSkills(await fetchSkills());
    } catch (loadError: unknown) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Failed to load skills",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const selectSkill = (skill: SkillData) => {
    const next = editorFromSkill(skill);
    setSelectedId(skill.id);
    setIsNew(false);
    setEditor(next);
    setBaseline(next);
    setError(null);
  };

  const startNew = () => {
    const next = emptySkillEditor();
    setSelectedId(null);
    setIsNew(true);
    setEditor(next);
    setBaseline(next);
    setError(null);
  };

  const cancelEdit = () => {
    setSelectedId(null);
    setIsNew(false);
    setEditor(emptySkillEditor());
    setBaseline(emptySkillEditor());
    setError(null);
  };

  const save = async () => {
    if (skillEditorsEqual(editor, baseline)) return;
    setSaving(true);
    setError(null);
    try {
      const saved = isNew
        ? await createSkillApi(editor)
        : selectedId
          ? await updateSkillApi(selectedId, editor)
          : null;
      if (!saved) return;
      const next = editorFromSkill(saved);
      await load();
      setSelectedId(saved.id);
      setIsNew(false);
      setEditor(next);
      setBaseline(next);
    } catch (saveError: unknown) {
      setError(
        saveError instanceof Error ? saveError.message : "Failed to save skill",
      );
    } finally {
      setSaving(false);
    }
  };

  const performDelete = async () => {
    if (!pendingDelete) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteSkillApi(pendingDelete.id);
      if (selectedId === pendingDelete.id) cancelEdit();
      setPendingDelete(null);
      await load();
    } catch (deleteError: unknown) {
      setError(
        deleteError instanceof Error
          ? deleteError.message
          : "Failed to delete skill",
      );
    } finally {
      setDeleting(false);
    }
  };

  return {
    skills,
    selectedId,
    isNew,
    editor,
    setEditor,
    saving,
    deleting,
    error,
    pendingDelete,
    setPendingDelete,
    selectSkill,
    startNew,
    cancelEdit,
    save,
    performDelete,
    selectedSkill: skills.find((skill) => skill.id === selectedId) ?? null,
    showEditor: isNew || selectedId !== null,
    editorDirty: !skillEditorsEqual(editor, baseline),
  };
}
