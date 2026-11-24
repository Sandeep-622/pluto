import ReactMarkdown from "react-markdown";
import { safeUrl, type AnswerSection } from "@/lib/contract";
import { Icon, PlutoMark } from "./icon";

export function Answer({ sections, includeWeb, loading }: { sections: AnswerSection[]; includeWeb: boolean; loading: boolean }) {
  return <div className="assistant-answer">
    <div className="answer-byline"><PlutoMark small /><strong>Pluto</strong><span className="mode-badge">{includeWeb ? "Books + web" : "Book only"}</span></div>
    {sections.length === 0 && loading && <p className="thinking" role="status">Finding supporting sources<span className="dots">...</span></p>}
    {sections.map((section) => <Section key={section.kind} section={section} includeWeb={includeWeb} />)}
  </div>;
}

function Section({ section, includeWeb }: { section: AnswerSection; includeWeb: boolean }) {
  const allowedLinks = new Set(section.sources.flatMap((source) => source.kind === "web" ? [source.url] : []));
  return <section className="answer-section" aria-label={section.kind === "web" ? "Web findings" : "From the books"}>
    {(includeWeb || section.kind === "web") && <h3 className="section-label"><Icon name={section.kind === "web" ? "globe" : "book"} size={16} />{section.kind === "web" ? "Web findings" : "From the books"}</h3>}
    {!section.text && section.status === "loading" && <p className="thinking" role="status">{section.kind === "web" ? "Searching the web" : "Reading relevant passages"}<span className="dots">...</span></p>}
    <div className={`prose ${section.status === "error" ? "unverified" : ""}`}><ReactMarkdown components={{
      a: ({ href, children }) => {
        const url = href ? safeUrl(href) : undefined;
        return url && allowedLinks.has(url) ? <a href={url} target="_blank" rel="noopener noreferrer">{children}</a> : <span>{children}</span>;
      },
      img: () => null
    }}>{section.text}</ReactMarkdown></div>
    {section.sources.length > 0 && <div className="sources" aria-label={`${section.kind === "web" ? "Website" : "Book"} citations`}>
      <div className="sources-label">{section.kind === "web" ? "WEBSITE SOURCES" : "BOOK SOURCES"}</div>
      <div className="source-list">{section.sources.map((source) => source.kind === "web" && safeUrl(source.url)
        ? <a className="source-card" href={source.url} key={source.id} target="_blank" rel="noopener noreferrer"><Icon name="globe" size={17} /><span><b>{source.title}</b><small>{new URL(source.url).hostname}</small></span><Icon name="link" size={14} /></a>
        : <div className="source-card" key={source.id}><Icon name="book" size={17} /><span><b>{source.title.replace(/\.pdf$/i, "")}</b><small>Indexed book passage [{source.id}]</small></span></div>)}</div>
    </div>}
    {section.notice && <p className={`section-notice ${section.status === "error" ? "error" : ""}`} role="status">{section.notice}</p>}
    {section.status === "stopped" && <p className="section-notice">Response stopped. This section may be incomplete.</p>}
  </section>;
}
