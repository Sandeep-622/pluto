import ReactMarkdown from "react-markdown";
import { feedbackReasonOptions, safeUrl, type AnswerSection, type FeedbackReason, type FeedbackValue } from "@/lib/contract";
import { Icon, PlutoMark } from "./icon";

export function Answer({
  sections,
  includeWeb,
  loading,
  feedback,
  reason,
  onFeedback,
  onReason,
  onCitationClick
}: {
  sections: AnswerSection[];
  includeWeb: boolean;
  loading: boolean;
  feedback?: FeedbackValue;
  reason?: FeedbackReason;
  onFeedback?: (value: FeedbackValue) => void;
  onReason?: (reason: FeedbackReason) => void;
  onCitationClick?: () => void;
}) {
  return <div className="assistant-answer">
    <div className="answer-byline"><PlutoMark small /><strong>Pluto</strong><span className="mode-badge">{includeWeb ? "Books + web" : "Book only"}</span></div>
    {sections.length === 0 && loading && <p className="thinking" role="status">Finding supporting sources<span className="dots">...</span></p>}
    {sections.map((section) => <Section key={section.kind} section={section} includeWeb={includeWeb} onCitationClick={onCitationClick} />)}
    {!loading && sections.length > 0 && onFeedback && <div className="feedback-bar" aria-label="Answer feedback">
      <button type="button" className={`feedback-btn ${feedback === "helpful" ? "active helpful" : ""}`} aria-pressed={feedback === "helpful"} onClick={() => onFeedback("helpful")}><Icon name="thumbUp" size={14}/>Helpful</button>
      <button type="button" className={`feedback-btn ${feedback === "not_helpful" ? "active not-helpful" : ""}`} aria-pressed={feedback === "not_helpful"} onClick={() => onFeedback("not_helpful")}><Icon name="thumbDown" size={14}/>Not helpful</button>
      {feedback && <span className="feedback-thanks">Thanks for the feedback.</span>}
    </div>}
    {!loading && feedback === "not_helpful" && onReason && <div className="reason-chips" role="group" aria-label="Why was this not helpful?">
      <span>What went wrong?</span>
      {feedbackReasonOptions.map((option) => <button key={option.value} type="button" className="reason-chip" aria-pressed={reason === option.value} onClick={() => onReason(option.value)}>{option.label}</button>)}
    </div>}
  </div>;
}

function Section({ section, includeWeb, onCitationClick }: { section: AnswerSection; includeWeb: boolean; onCitationClick?: () => void }) {
  const allowedLinks = new Set(section.sources.flatMap((source) => source.kind === "web" ? [source.url] : []));
  return <section className="answer-section" aria-label={section.kind === "web" ? "Web findings" : "From the books"}>
    {(includeWeb || section.kind === "web") && <h3 className="section-label"><Icon name={section.kind === "web" ? "globe" : "book"} size={16} />{section.kind === "web" ? "Web findings" : "From the books"}</h3>}
    {!section.text && section.status === "loading" && <p className="thinking" role="status">{section.kind === "web" ? "Searching the web" : "Reading relevant passages"}<span className="dots">...</span></p>}
    <div className={`prose ${section.status === "error" ? "unverified" : ""}`}><ReactMarkdown components={{
      a: ({ href, children }) => {
        const url = href ? safeUrl(href) : undefined;
        return url && allowedLinks.has(url) ? <a href={url} target="_blank" rel="noopener noreferrer" onClick={onCitationClick}>{children}</a> : <span>{children}</span>;
      },
      img: () => null
    }}>{section.text}</ReactMarkdown></div>
    {section.sources.length > 0 && <div className="sources" aria-label={`${section.kind === "web" ? "Website" : "Book"} citations`}>
      <div className="sources-label">{section.kind === "web" ? "WEBSITE SOURCES" : "BOOK SOURCES"}</div>
      <div className="source-list">{section.sources.map((source) => source.kind === "web" && safeUrl(source.url)
        ? <a className="source-card" href={source.url} key={source.id} target="_blank" rel="noopener noreferrer" onClick={onCitationClick}><Icon name="globe" size={17} /><span><b>{source.title}</b><small>{new URL(source.url).hostname}</small></span><Icon name="link" size={14} /></a>
        : <div className="source-card" key={source.id}><Icon name="book" size={17} /><span><b>{source.title.replace(/\.pdf$/i, "")}</b><small>Indexed book passage [{source.id}]</small></span></div>)}</div>
    </div>}
    {section.notice && <p className={`section-notice ${section.status === "error" ? "error" : ""}`} role="status">{section.notice}</p>}
    {section.status === "stopped" && <p className="section-notice">Response stopped. This section may be incomplete.</p>}
  </section>;
}
