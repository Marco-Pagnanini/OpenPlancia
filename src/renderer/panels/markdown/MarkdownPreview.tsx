import Markdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

const components: Components = {
  // Links leave the app: http(s) opens in the system browser, anything else is inert.
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href && /^https?:\/\//.test(href)) void window.plancia.app.openExternal(href);
      }}
    >
      {children}
    </a>
  ),
};

export function MarkdownPreview({ content }: { content: string }) {
  return (
    <div className="md-preview">
      <Markdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </Markdown>
    </div>
  );
}
