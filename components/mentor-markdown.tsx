"use client";

import type { Components } from "react-markdown";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

const markdownComponents: Components = {
  h1: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-slate-900 first:mt-0">{children}</h3>
  ),
  h2: ({ children }) => (
    <h3 className="mb-2 mt-4 text-base font-semibold text-slate-900 first:mt-0">{children}</h3>
  ),
  h3: ({ children }) => (
    <h4 className="mb-2 mt-3 text-sm font-semibold text-slate-900 first:mt-0">{children}</h4>
  ),
  h4: ({ children }) => (
    <h5 className="mb-1 mt-3 text-sm font-semibold text-slate-800 first:mt-0">{children}</h5>
  ),
  p: ({ children }) => <p className="mb-3 last:mb-0 leading-6 text-slate-700">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc space-y-1 pl-5 text-slate-700 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal space-y-1 pl-5 text-slate-700 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="leading-6">{children}</li>,
  strong: ({ children }) => <strong className="font-semibold text-slate-900">{children}</strong>,
  em: ({ children }) => <em className="italic text-slate-700">{children}</em>,
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
        className="rounded bg-slate-200/80 px-1.5 py-0.5 font-mono text-[0.8125rem] text-slate-800"
        {...props}
      >
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-3 max-h-64 overflow-auto rounded-md border border-slate-200 bg-slate-900 p-3 last:mb-0">
      {children}
    </pre>
  ),
  a: ({ href, children }) => (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className="font-medium text-blue-700 underline decoration-blue-700/40 underline-offset-2 hover:text-blue-800"
    >
      {children}
    </a>
  ),
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-slate-300 pl-3 text-slate-600 last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-4 border-slate-200" />
};

type MentorMarkdownProps = {
  content: string;
};

export function MentorMarkdown({ content }: MentorMarkdownProps) {
  return (
    <div className="mentor-answer mt-4 max-h-[min(28rem,60vh)] overflow-y-auto rounded-md border border-slate-200 bg-slate-50 p-4 text-sm">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
