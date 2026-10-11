import { BuiltinCapabilities } from "./BuiltinCapabilities";
import { McpServersSection } from "./McpServersSection";

export function ToolsTab() {
  return (
    <div className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex max-w-[760px] flex-col gap-8 px-5 py-5">
        <BuiltinCapabilities />
        <McpServersSection />
      </div>
    </div>
  );
}
