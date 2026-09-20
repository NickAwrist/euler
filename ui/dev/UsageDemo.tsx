import { UsagePage } from "../components/UsagePage";

// API requests are intercepted by Playwright, with no live backend.
export default function UsageDemo() {
  return (
    <UsagePage
      onBack={() => {
        window.location.href = "/";
      }}
    />
  );
}
