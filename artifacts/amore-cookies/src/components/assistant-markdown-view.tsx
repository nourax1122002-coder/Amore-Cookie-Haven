import { Fragment, type ReactNode } from "react";
import { parseAssistantInline, parseAssistantMarkdown } from "./assistant-markdown";

function InlineMarkdown({ text }: { text: string }) {
  return (
    <>
      {parseAssistantInline(text).map((part, index) => part.bold
        ? <strong key={index} className="font-bold">{part.text}</strong>
        : <Fragment key={index}>{part.text}</Fragment>)}
    </>
  );
}

function renderInlineList(items: string[], tag: "ul" | "ol", className: string): ReactNode {
  const List = tag;
  return (
    <List className={className}>
      {items.map((item, index) => <li key={`${index}-${item.slice(0, 12)}`}><InlineMarkdown text={item}/></li>)}
    </List>
  );
}

export function AssistantMarkdownView({ content }: { content: string }) {
  return (
    <div className="assistant-markdown space-y-2 break-words" data-testid="assistant-markdown">
      {parseAssistantMarkdown(content).map((block, index) => {
        if (block.type === "heading") {
          const Heading = `h${Math.min(block.level + 1, 4)}` as "h2" | "h3" | "h4";
          return <Heading key={index} className="font-semibold leading-6">{<InlineMarkdown text={block.text}/>}</Heading>;
        }
        if (block.type === "list") {
          return <Fragment key={index}>{renderInlineList(block.items, block.ordered ? "ol" : "ul", `space-y-1 ps-5 ${block.ordered ? "list-decimal" : "list-disc"}`)}</Fragment>;
        }
        return <p key={index} className="whitespace-normal">{<InlineMarkdown text={block.text}/>}</p>;
      })}
    </div>
  );
}
