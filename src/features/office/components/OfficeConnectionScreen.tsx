"use client";

import { useUiText } from "@/lib/i18n/ui-language";
import styles from "./OfficeConnectionScreen.module.css";

export function OfficeConnectionScreen({ connecting = false }: { connecting?: boolean }) {
  const t = useUiText();
  const title = t(connecting ? "Connecting to your office" : "Opening your office");

  return <div className={styles.screen} role="status" aria-label={title}>
    <div className={styles.brand} aria-hidden="true">
      <svg viewBox="0 0 24 24" fill="none"><circle cx="12" cy="12" r="8" /><path d="m12 7 5 5-5 5-5-5Z" /></svg>
      <span>THE OFFICE</span>
    </div>
    <div className={styles.content}>
      <svg className={styles.signal} viewBox="0 0 320 320" fill="none" aria-hidden="true">
        <circle className={styles.halo} cx="160" cy="160" r="56" />
        <g className={styles.guides}>
          <circle cx="160" cy="160" r="112" />
          <circle cx="160" cy="160" r="76" />
          <path d="M160 32v20m0 216v20M32 160h20m216 0h20" />
          <path d="m81 81 8 8m142 142 8 8m0-158-8 8M89 231l-8 8" />
        </g>
        <g className={styles.orbit}>
          <circle cx="160" cy="160" r="112" strokeDasharray="72 632" />
          <circle cx="160" cy="48" r="4" />
        </g>
        <g className={styles.innerOrbit}>
          <circle cx="160" cy="160" r="76" strokeDasharray="36 442" />
        </g>
        <g className={styles.core}>
          <path d="m160 133 27 27-27 27-27-27Z" />
          <path d="m160 149 11 11-11 11-11-11Z" />
          <path d="M160 114v9m0 74v9m-46-46h9m74 0h9" />
        </g>
        <g className={styles.stars}>
          <circle cx="49" cy="69" r="1.5" /><circle cx="272" cy="101" r="1" />
          <circle cx="53" cy="246" r="1" /><circle cx="258" cy="263" r="1.5" />
          <circle cx="202" cy="24" r="1" /><circle cx="113" cy="292" r="1" />
        </g>
      </svg>
      <h1>{title}</h1>
      <p>{t("Your crew and conversations, in one place.")}</p>
      <div className={styles.track} aria-hidden="true"><span /></div>
      <span className={styles.caption}>{t(connecting ? "Establishing connection…" : "Loading your workspace…")}</span>
    </div>
  </div>;
}
