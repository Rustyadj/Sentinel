// Knowledge Engine — note templates

export interface NoteTemplate {
  id: string;
  label: string;
  content: string;
}

export const NOTE_TEMPLATES: NoteTemplate[] = [
  {
    id: "meeting-notes",
    label: "Meeting Notes",
    content: `## Attendees\n\n- \n\n## Discussion\n\n\n\n## Action Items\n\n- [ ] \n\n## Related\n\n[[Project]]\n`,
  },
  {
    id: "decision-record",
    label: "Decision Record",
    content: `## Context\n\n\n\n## Decision\n\n\n\n## Alternatives Considered\n\n- \n\n## Related\n\n[[Project]]\n`,
  },
  {
    id: "project-brief",
    label: "Project Brief",
    content: `## Goal\n\n\n\n## Scope\n\n\n\n## Stakeholders\n\n- \n\n## Related\n\n[[Team]]\n`,
  },
];

export function applyTemplate(
  templateId: string,
  vars: { title?: string }
): { title: string; content: string } {
  const template = NOTE_TEMPLATES.find((t) => t.id === templateId);
  return {
    title: vars.title ?? template?.label ?? "Untitled",
    content: template?.content ?? "",
  };
}
