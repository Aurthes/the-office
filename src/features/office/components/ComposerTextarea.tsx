"use client";
import { forwardRef, useRef, type ChangeEvent, type TextareaHTMLAttributes } from "react";

// External dictation/accessibility tools can emit input after assigning .value,
// bypassing React's change tracker. Feed that event through the mention editor
// too, while processing normal browser input only once.
export const ComposerTextarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(function ComposerTextarea({ onChange, onInput, ...props }, ref) {
  const lastInput = useRef<Event | null>(null);
  const change = (event: ChangeEvent<HTMLTextAreaElement>) => {
    if (lastInput.current === event.nativeEvent) return;
    lastInput.current = event.nativeEvent;
    onChange?.(event);
  };
  return <textarea {...props} ref={ref} role="textbox" aria-expanded={undefined} onChange={change} onInput={event => { change(event as ChangeEvent<HTMLTextAreaElement>); onInput?.(event); }} />;
});
