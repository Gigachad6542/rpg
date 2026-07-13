import type { RuntimeCard } from "./runtimeTypes";

export type CardLibraryFilters = {
  query: string;
  tag: string;
  favoritesOnly: boolean;
  includeArchived: boolean;
};

export function getCardLibraryTags(cards: readonly RuntimeCard[]): string[] {
  const tags = new Map<string, string>();
  for (const card of cards) {
    for (const tag of card.tags ?? []) {
      const cleaned = tag.replace(/\s+/g, " ").trim().slice(0, 48);
      if (cleaned) tags.set(cleaned.toLocaleLowerCase(), cleaned);
    }
  }
  return [...tags.values()].sort((left, right) => left.localeCompare(right));
}
export function filterAndSortCards(cards: readonly RuntimeCard[], filters: CardLibraryFilters): RuntimeCard[] {
  const query = filters.query.trim().toLocaleLowerCase();
  const tag = filters.tag.trim().toLocaleLowerCase();
  return cards
    .filter((card) => filters.includeArchived || !card.archived)
    .filter((card) => !filters.favoritesOnly || card.favorite)
    .filter((card) => !tag || (card.tags ?? []).some((value) => value.toLocaleLowerCase() === tag))
    .filter((card) => {
      if (!query) return true;
      return [card.name, card.summary, card.characterName, ...(card.tags ?? [])]
        .join(" ")
        .toLocaleLowerCase()
        .includes(query);
    })
    .sort((left, right) => {
      const favoriteDelta = Number(Boolean(right.favorite)) - Number(Boolean(left.favorite));
      if (favoriteDelta !== 0) return favoriteDelta;
      return left.name.localeCompare(right.name);
    });
}
