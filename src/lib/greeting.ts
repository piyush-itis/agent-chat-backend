function compactUserText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[!?.,]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function isGreetingOnly(text: string): boolean {
  const compact = compactUserText(text);
  if (!compact || compact.length > 40) return false;
  return /^(?:please\s+)?(?:say\s+)?(?:hi|hey|hello|heyey|heya|yo|sup|hola)(?:\s+there)?$/.test(
    compact,
  );
}

export function localChatReply(text: string): string | null {
  const compact = compactUserText(text);
  if (!compact || compact.length > 60) return null;
  if (isGreetingOnly(text)) return "Hi — what should we work on?";
  if (/^(how are you|how r you|how're you|how are u)(?: doing)?$/.test(compact)) {
    return "Doing well. What should we work on?";
  }
  if (/^(what'?s up|wassup)$/.test(compact)) return "Here and ready. What should we work on?";
  if (/^(thanks|thank you|thx|ty)$/.test(compact)) return "You're welcome.";
  if (/^(ok|okay|cool|got it|nice|great)$/.test(compact)) return "Sounds good.";
  return null;
}
