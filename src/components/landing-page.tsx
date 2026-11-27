"use client";

import { GoogleSignInButton } from "./google-auth";
import { Icon, PlutoMark } from "./icon";

export function LandingPage({
  error,
  onDismissError,
  onCredential,
  onError
}: {
  error: string;
  onDismissError: () => void;
  onCredential: (credential: string) => void;
  onError: (message: string) => void;
}) {
  return <div className="landing-shell">
    <header className="landing-header">
      <div className="brand">
        <PlutoMark />
        <span>pluto<span className="brand-dot">.</span></span>
      </div>
      <div className="landing-badge"><span />MEDICAL READING ROOM<b>POC</b></div>
    </header>

    <main className="landing-main">
      <section className="landing-intro">
        <div className="eyebrow"><span />GROUNDED IN YOUR BOOKS</div>
        <h1>A question is a<br />good place to <em>start.</em></h1>
        <p className="landing-description">
          Make sense of the medicine you read. Explore concepts, connect ideas, and trace every answer back to its indexed textbook source.
        </p>
        <div className="welcome-rule" />
        <ul className="landing-highlights">
          <li>
            <span className="landing-highlight-icon"><Icon name="book" size={17} /></span>
            <div>
              <strong>Book-first answers</strong>
              <span>Every response is retrieved from your indexed medical books with book-level citations.</span>
            </div>
          </li>
          <li>
            <span className="landing-highlight-icon"><Icon name="globe" size={17} /></span>
            <div>
              <strong>Optional web research</strong>
              <span>Opt in to website findings when you want public references alongside book passages.</span>
            </div>
          </li>
          <li>
            <span className="landing-highlight-icon"><Icon name="shield" size={17} /></span>
            <div>
              <strong>Browser-local history</strong>
              <span>Your conversations stay on this device and can be cleared anytime.</span>
            </div>
          </li>
        </ul>
      </section>

      <section className="landing-card" aria-label="Sign in to Pluto">
        <div className="landing-card-eyebrow">GOOGLE AUTHENTICATION</div>
        <h2>Sign in to continue</h2>
        <p className="landing-card-copy">
          Sign in with your Google account to open the reading room and start asking questions.
        </p>

        {error && <div className="request-error landing-error" role="alert">
          <span>{error}</span>
          <button type="button" aria-label="Dismiss message" onClick={onDismissError}><Icon name="close" size={14} /></button>
        </div>}

        <div className="landing-signin-slot">
          <GoogleSignInButton onCredential={onCredential} onError={onError} />
        </div>

        <p className="landing-card-note">
          <Icon name="check" size={13} />
          <span>Any verified Google account is welcome.</span>
        </p>
      </section>
    </main>

    <footer className="landing-footer">
      <p className="disclaimer">
        For learning, not medical decisions. Sources may be incomplete or outdated. Don&apos;t enter identifiable patient information.
      </p>
    </footer>
  </div>;
}
