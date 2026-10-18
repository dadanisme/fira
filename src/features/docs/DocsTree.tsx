import { SidebarSection } from '../../app/SidebarSection';

// Placeholder — owned by the docs feature. Rendered (lazily) in the sidebar below the projects.
// Keep Tiptap out of this module's imports: it loads with the shell.
export default function DocsTree() {
  return (
    <SidebarSection title="Docs">
      <p className="px-2 text-xs text-fg-faint">No pages yet</p>
    </SidebarSection>
  );
}
