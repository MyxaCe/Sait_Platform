export function MarkdownText({
  markdown,
  paragraphClassName = 'leading-relaxed text-primary/90',
}: {
  markdown: string;
  paragraphClassName?: string;
}) {
  return (
    <>
      {markdown
        .split(/\n{2,}/)
        .map((paragraph) => paragraph.trim())
        .filter(Boolean)
        .map((paragraph, i) => (
          <p key={i} className={paragraphClassName}>
            {paragraph}
          </p>
        ))}
    </>
  );
}
