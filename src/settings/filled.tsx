/** Renders a translated sentence whose `{name}` placeholder carries markup.
 *  The sentence stays whole in the dictionary; only its rendering is split, so
 *  a translator never has to reassemble one from halves. */
import type { ReactNode } from "react";

export function Filled({
  message,
  name,
  children,
}: {
  message: string;
  name: string;
  children: ReactNode;
}) {
  const marker = `{${name}}`;
  const at = message.indexOf(marker);
  if (at < 0) return <>{message}</>;
  return (
    <>
      {message.slice(0, at)}
      {children}
      {message.slice(at + marker.length)}
    </>
  );
}
