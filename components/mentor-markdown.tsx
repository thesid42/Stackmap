"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-slate-100 first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-slate-100 first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-2 mt-3 text-sm font-semibold text-slate-100 first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mb-1 mt-3 text-sm font-semibold text-slate-200 first:mt-0">{children}</h5>
  ),
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-6 text-slate-200/90">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-slate-200/90 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-200/90 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-white">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-300">{children}</em>,
  code: ({ className, children, ...props }) => {
    const isBlock = Boolean(className?.includes("language-"));
    if (isBlock) {
      return (
        <code className={`block font-mono text-xs leading-5 text-slate-100 ${className ?? ""}`} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded border border-white/10 bg-white/10 px-1.5 py-0.5 font-mono text-[0.8125rem] text-slate-100"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3 max-h-64 overflow-auto rounded-lg border border-white/10 bg-black/25 p-3 last:mb-0 backdrop-blur-sm">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue-300 underline decoration-blue-300/40 underline-offset-2 hover:text-blue-200"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-white/20 pl-3 text-slate-300 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-white/15" />
};

type MentorMarkdownProps = {
  content: string;
};

export function MentorMarkdown({ content }: MentorMarkdownProps) {
  return (
    <div className="mentor-markdown text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
