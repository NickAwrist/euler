import {
  Braces,
  File,
  FileCode2,
  FileImage,
  FileText,
  Folder,
  FolderOpen,
  Settings2,
  Table2,
  Terminal,
} from "lucide-react";
import { cx } from "../../styles";
import { fileLanguage } from "./fileTypes";

export function FileIcon({
  path,
  directory = false,
  expanded = false,
  className,
}: {
  path: string;
  directory?: boolean;
  expanded?: boolean;
  className?: string;
}) {
  const language = fileLanguage(path);
  const [Icon, color] = directory
    ? ([expanded ? FolderOpen : Folder, "text-amber-400/80"] as const)
    : /\.(png|jpe?g|gif|webp|avif|svg|ico|bmp)$/i.test(path)
      ? ([FileImage, "text-violet-400"] as const)
      : /\.(csv|tsv)$/i.test(path)
        ? ([Table2, "text-emerald-400"] as const)
        : language === "markdown"
          ? ([FileText, "text-sky-400"] as const)
          : language === "json" || language === "jsonc"
            ? ([Braces, "text-amber-400"] as const)
            : ["yaml", "toml"].includes(language)
              ? ([Settings2, "text-slate-400"] as const)
              : ["bash", "shellscript"].includes(language)
                ? ([Terminal, "text-emerald-400"] as const)
                : language !== "text"
                  ? ([FileCode2, "text-blue-400"] as const)
                  : ([File, "text-muted-foreground"] as const);
  return (
    <Icon
      size={16}
      aria-hidden="true"
      className={cx("shrink-0", color, className)}
    />
  );
}
