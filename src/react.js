"use client";

// React component. Works with React 18 and 19, including Next.js (client only).
//
//   import { LeaveAMark } from "leave-a-mark/react";
//   <LeaveAMark api="https://guestbook.you.workers.dev" siteKey="0x4AAA…" />
//
// To put the form and the messages in different places, use it twice:
//   <LeaveAMark parts="form" … />  and  <LeaveAMark parts="entries" … />

import { createElement, useEffect, useRef } from "react";
import { createGuestbook } from "./guestbook.js";

export function LeaveAMark({ className, style, api, siteKey, lang, labels, parts, theme, demo, title, onSigned }) {
  const box = useRef(null);
  const book = useRef(null);
  const signed = useRef(onSigned);
  signed.current = onSigned;
  const opts = { api, siteKey, lang, labels, parts, theme, demo, title };
  for (const k of Object.keys(opts)) if (opts[k] === undefined) delete opts[k];
  const key = JSON.stringify(opts);

  useEffect(() => {
    book.current = createGuestbook(box.current, { ...JSON.parse(key), onSigned: (m) => signed.current?.(m) });
    return () => {
      book.current?.destroy();
      book.current = null;
    };
    // created once; later changes go through update()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    book.current?.update(JSON.parse(key));
  }, [key]);

  return createElement("div", { ref: box, className, style });
}
