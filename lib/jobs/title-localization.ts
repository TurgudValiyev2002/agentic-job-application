/**
 * Local-language search titles for non-English Indeed markets. An English query such as "Backend Engineer" on
 * fr.indeed.com is fuzzy-matched into "Business Developer" listings, while "Développeur backend" finds the real
 * postings. The English title is always searched as well, because many postings in these markets are in English.
 * Only job titles are translated, never a person's CV.
 */
type Language = "fr" | "de" | "es" | "it" | "nl" | "pt";

const languageByCountry: Record<string, Language> = {
  fr: "fr", be: "fr", lu: "fr", de: "de", at: "de", ch: "de", es: "es", mx: "es", ar: "es", cl: "es", co: "es", pe: "es",
  ec: "es", cr: "es", pa: "es", uy: "es", ve: "es", it: "it", nl: "nl", pt: "pt", br: "pt",
};

/** Role nouns and their modifiers. `nounFirst` languages say "Ingénieur logiciel"; the others "Software Entwickler". */
const dictionaries: Record<Language, { nounFirst: boolean; nouns: Record<string, string>; modifiers: Record<string, string> }> = {
  fr: { nounFirst: true, nouns: { engineer: "ingénieur", developer: "développeur", programmer: "développeur", researcher: "chercheur", architect: "architecte", analyst: "analyste", scientist: "scientist", administrator: "administrateur", consultant: "consultant" },
    modifiers: { software: "logiciel", platform: "plateforme", data: "data", ai: "IA", "artificial intelligence": "IA", "machine learning": "machine learning", embedded: "embarqué", security: "sécurité", cloud: "cloud", web: "web", mobile: "mobile", backend: "backend", "back-end": "backend", frontend: "frontend", "front-end": "frontend", "full stack": "full stack", "full-stack": "full stack", fullstack: "full stack", devops: "devops", systems: "systèmes", system: "système", network: "réseau", database: "base de données", qa: "QA", test: "test", research: "recherche" } },
  de: { nounFirst: false, nouns: { engineer: "Entwickler", developer: "Entwickler", programmer: "Programmierer", researcher: "Forscher", architect: "Architekt", analyst: "Analyst", scientist: "Scientist", administrator: "Administrator", consultant: "Berater" },
    modifiers: { software: "Software", platform: "Plattform", data: "Data", ai: "KI", "artificial intelligence": "KI", "machine learning": "Machine Learning", embedded: "Embedded", security: "Security", cloud: "Cloud", web: "Web", mobile: "Mobile", backend: "Backend", "back-end": "Backend", frontend: "Frontend", "front-end": "Frontend", "full stack": "Full Stack", "full-stack": "Full Stack", fullstack: "Full Stack", devops: "DevOps", systems: "System", system: "System", network: "Netzwerk", database: "Datenbank", qa: "QA", test: "Test", research: "Forschung" } },
  es: { nounFirst: true, nouns: { engineer: "ingeniero", developer: "desarrollador", programmer: "programador", researcher: "investigador", architect: "arquitecto", analyst: "analista", scientist: "científico", administrator: "administrador", consultant: "consultor" },
    modifiers: { software: "de software", platform: "de plataforma", data: "de datos", ai: "de IA", "artificial intelligence": "de IA", "machine learning": "de machine learning", embedded: "embebido", security: "de seguridad", cloud: "cloud", web: "web", mobile: "móvil", backend: "backend", "back-end": "backend", frontend: "frontend", "front-end": "frontend", "full stack": "full stack", "full-stack": "full stack", fullstack: "full stack", devops: "devops", systems: "de sistemas", system: "de sistemas", network: "de redes", database: "de bases de datos", qa: "QA", test: "de pruebas", research: "de investigación" } },
  it: { nounFirst: true, nouns: { engineer: "ingegnere", developer: "sviluppatore", programmer: "programmatore", researcher: "ricercatore", architect: "architetto", analyst: "analista", scientist: "scientist", administrator: "amministratore", consultant: "consulente" },
    modifiers: { software: "software", platform: "piattaforma", data: "data", ai: "IA", "artificial intelligence": "IA", "machine learning": "machine learning", embedded: "embedded", security: "sicurezza", cloud: "cloud", web: "web", mobile: "mobile", backend: "backend", "back-end": "backend", frontend: "frontend", "front-end": "frontend", "full stack": "full stack", "full-stack": "full stack", fullstack: "full stack", devops: "devops", systems: "sistemi", system: "sistemi", network: "reti", database: "database", qa: "QA", test: "test", research: "ricerca" } },
  nl: { nounFirst: false, nouns: { engineer: "engineer", developer: "ontwikkelaar", programmer: "programmeur", researcher: "onderzoeker", architect: "architect", analyst: "analist", scientist: "scientist", administrator: "beheerder", consultant: "consultant" },
    modifiers: { software: "software", platform: "platform", data: "data", ai: "AI", "artificial intelligence": "AI", "machine learning": "machine learning", embedded: "embedded", security: "security", cloud: "cloud", web: "web", mobile: "mobile", backend: "backend", "back-end": "backend", frontend: "frontend", "front-end": "frontend", "full stack": "full stack", "full-stack": "full stack", fullstack: "full stack", devops: "devops", systems: "systeem", system: "systeem", network: "netwerk", database: "database", qa: "QA", test: "test", research: "onderzoek" } },
  pt: { nounFirst: true, nouns: { engineer: "engenheiro", developer: "desenvolvedor", programmer: "programador", researcher: "pesquisador", architect: "arquiteto", analyst: "analista", scientist: "cientista", administrator: "administrador", consultant: "consultor" },
    modifiers: { software: "de software", platform: "de plataforma", data: "de dados", ai: "de IA", "artificial intelligence": "de IA", "machine learning": "de machine learning", embedded: "embarcado", security: "de segurança", cloud: "cloud", web: "web", mobile: "mobile", backend: "backend", "back-end": "backend", frontend: "frontend", "front-end": "frontend", "full stack": "full stack", "full-stack": "full stack", fullstack: "full stack", devops: "devops", systems: "de sistemas", system: "de sistemas", network: "de redes", database: "de banco de dados", qa: "QA", test: "de testes", research: "de pesquisa" } },
};

const IGNORED = new Set(["senior", "junior", "lead", "principal", "staff", "mid", "mid-level", "intern", "of", "the", "and", "/", "&", "-"]);

/** The local-language form of an English job title for an Indeed country code, or null when the title has no role noun to translate. */
export function localizedTitle(title: string, countryCode: string): string | null {
  const language = languageByCountry[countryCode.toLowerCase()];
  if (!language) return null;
  const { nounFirst, nouns, modifiers } = dictionaries[language];
  const words = title.toLowerCase().replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  // Two-word modifiers first ("machine learning", "full stack"), then single words.
  const modifiersFound: string[] = [];
  let noun: string | null = null;
  for (let index = 0; index < words.length; index++) {
    const pair = `${words[index]} ${words[index + 1] ?? ""}`.trim();
    if (index + 1 < words.length && modifiers[pair]) { modifiersFound.push(modifiers[pair]); index++; continue; }
    const word = words[index];
    if (IGNORED.has(word)) continue;
    if (nouns[word] && !noun) { noun = nouns[word]; continue; }
    modifiersFound.push(modifiers[word] ?? word);
  }
  if (!noun) return null;
  const phrase = (nounFirst ? [noun, ...modifiersFound] : [...modifiersFound, noun]).join(" ").replace(/\s+/g, " ").trim();
  return phrase.toLowerCase() === title.toLowerCase() ? null : phrase;
}

/** The English title first, then the local form when the market has one and it differs. */
export function searchTitlesFor(title: string, countryCode: string): string[] {
  const local = localizedTitle(title, countryCode);
  return local ? [title, local] : [title];
}
