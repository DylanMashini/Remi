"use client";

import { useState, useTransition } from "react";
import { addMemory, type FormState } from "@/app/(care)/actions";
import { buttonSecondary, Field, FormStatus, textareaClass } from "../ui";

export function AddMemoryForm({ personId, personName }: { personId: string; personName: string }) {
  const [state, setState] = useState<FormState>({});
  const [pending, start] = useTransition();
  const [text, setText] = useState("");

  function submit(fd: FormData) {
    start(async () => {
      const r = await addMemory(personId, {}, fd);
      setState(r);
      if (r.ok) setText("");
    });
  }

  return (
    <form action={submit} className="flex flex-col gap-3">
      <Field
        label={`Something to remember about ${personName.split(" ")[0]}`}
        htmlFor="memory-text"
        hint="Write it the way you would say it to them. It becomes one short spoken sentence you can edit."
      >
        <textarea
          id="memory-text"
          name="text"
          required
          rows={2}
          maxLength={1000}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="You two used to walk the dog along the river every morning."
          className={textareaClass}
        />
      </Field>
      <FormStatus error={state.error} ok={state.ok ? "Memory added. It is switched on and will be spoken as the newest one." : null} />
      <div>
        <button type="submit" disabled={pending || !text.trim()} className={buttonSecondary}>
          {pending ? "Adding" : "Add memory"}
        </button>
      </div>
    </form>
  );
}
