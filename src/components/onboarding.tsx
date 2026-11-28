"use client";

import { useState } from "react";
import { ageBandOptions, roleOptions, type AgeBand, type ProfileRequest, type Role } from "@/lib/contract";
import { Icon, PlutoMark } from "./icon";

export function Onboarding({ name, saving, error, onSubmit }: {
  name?: string;
  saving: boolean;
  error: string;
  onSubmit: (profile: ProfileRequest) => void;
}) {
  const [role, setRole] = useState<Role | null>(null);
  const [ageBand, setAgeBand] = useState<AgeBand | "">("");
  const ready = role !== null && ageBand !== "";

  return <div className="landing-shell onboarding-shell">
    <header className="landing-header">
      <div className="brand"><PlutoMark /><span>pluto<span className="brand-dot">.</span></span></div>
      <div className="landing-badge"><span />ONE-TIME SETUP</div>
    </header>
    <main className="onboarding-main">
      <form className="onboarding-card" aria-label="Tell us about you" onSubmit={(event) => { event.preventDefault(); if (role && ageBand) onSubmit({ role, ageBand }); }}>
        <div className="landing-card-eyebrow">WELCOME{name ? `, ${name.split(" ")[0].toUpperCase()}` : ""}</div>
        <h2>Tell us a little about you</h2>
        <p className="landing-card-copy">This helps us understand who Pluto is helping. You&apos;ll only be asked once. We record usage statistics, but never the text of your questions.</p>

        <fieldset className="role-fieldset">
          <legend>I am a…</legend>
          <div className="role-cards">
            {roleOptions.map((option) => <label key={option.value} className={`role-card ${role === option.value ? "selected" : ""}`}>
              <input type="radio" name="role" value={option.value} checked={role === option.value} onChange={() => setRole(option.value)} />
              <strong>{option.label}</strong>
              <span>{option.hint}</span>
              {role === option.value && <Icon name="check" size={15} />}
            </label>)}
          </div>
        </fieldset>

        <div className="age-field">
          <label htmlFor="age-band">Age range</label>
          <select id="age-band" value={ageBand} onChange={(event) => setAgeBand(event.target.value as AgeBand | "")}>
            <option value="" disabled>Select your age range</option>
            {ageBandOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
          </select>
        </div>

        {error && <div className="request-error landing-error" role="alert"><span>{error}</span></div>}
        <button className="onboarding-submit" type="submit" disabled={!ready || saving}>{saving ? "Saving…" : "Continue to Pluto"}<Icon name="chevron" size={16} /></button>
      </form>
    </main>
  </div>;
}
