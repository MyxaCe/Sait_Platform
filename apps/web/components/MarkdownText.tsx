/**
 * Рендер bodyMarkdown из CMS. Текущий мок-контент — plain-параграфы,
 * поэтому пока это разбиение по пустым строкам. При появлении реальной
 * разметки из CMS подключается remark + rehype-sanitize (контракт
 * запрещает raw HTML — см. спецификацию §8.1) — точка замены одна.
 */
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
