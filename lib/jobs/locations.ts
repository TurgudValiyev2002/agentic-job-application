/** Indeed's country sites: https://www.indeed.com/worldwide. Never inferred from a CV. */
const countries = [
  ["us", "www", "United States", "USA", "United States of America"],
  ["gb", "uk", "United Kingdom", "UK", "Great Britain", "England", "Scotland", "Wales"],
  ["de", "de", "Deutschland", "Germany"], ["at", "at", "Österreich", "Austria"],
  ["ch", "ch", "Schweiz", "Switzerland", "Suisse"], ["ca", "ca", "Canada"],
  ["au", "au", "Australia"], ["nl", "nl", "Nederland", "Netherlands"],
  ["fr", "fr", "France"], ["ie", "ie", "Ireland"], ["sg", "sg", "Singapore"],
  ["in", "in", "India"], ["nz", "nz", "New Zealand"], ["es", "es", "España", "Spain"],
  ["it", "it", "Italia", "Italy"], ["pt", "pt", "Portugal"], ["be", "be", "Belgium", "Belgique", "België"],
  ["se", "se", "Sverige", "Sweden"], ["no", "no", "Norge", "Norway"], ["dk", "dk", "Danmark", "Denmark"],
  ["fi", "fi", "Suomi", "Finland"], ["pl", "pl", "Polska", "Poland"], ["cz", "cz", "Česko", "Czech Republic", "Czechia"],
  ["hu", "hu", "Magyarország", "Hungary"], ["ro", "ro", "România", "Romania"], ["gr", "gr", "Greece"],
  ["tr", "tr", "Türkiye", "Turkey"], ["ua", "ua", "Ukraine"], ["lu", "lu", "Luxembourg"],
  ["jp", "jp", "Japan"], ["kr", "kr", "South Korea"], ["cn", "cn", "China"], ["hk", "hk", "Hong Kong"],
  ["tw", "tw", "Taiwan"], ["th", "th", "Thailand"], ["vn", "vn", "Vietnam"], ["id", "id", "Indonesia"],
  ["ph", "ph", "Philippines"], ["pk", "pk", "Pakistan"], ["ae", "ae", "United Arab Emirates", "UAE"],
  ["sa", "sa", "Saudi Arabia"], ["qa", "qa", "Qatar"], ["bh", "bh", "Bahrain"], ["kw", "kw", "Kuwait"],
  ["om", "om", "Oman"], ["il", "il", "Israel"], ["eg", "eg", "Egypt"], ["ma", "ma", "Morocco"],
  ["za", "za", "South Africa"], ["ng", "ng", "Nigeria"], ["br", "br", "Brasil", "Brazil"],
  ["mx", "mx", "México", "Mexico"], ["ar", "ar", "Argentina"], ["cl", "cl", "Chile"],
  ["co", "co", "Colombia"], ["pe", "pe", "Peru"], ["ec", "ec", "Ecuador"], ["cr", "cr", "Costa Rica"],
  ["pa", "pa", "Panama"], ["uy", "uy", "Uruguay"], ["ve", "ve", "Venezuela"],
];
export const internationalSearchCountries = ["United States", "United Kingdom", "Germany", "Canada", "Australia", "Netherlands", "France", "Ireland", "Switzerland", "Austria", "Singapore", "India"];
const normalize = (text: string) => text.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().trim();
export function searchCountry(value: string) {
  return countries.find(([code, host, name, ...aliases]) => [code, host, name, ...aliases].some(alias => normalize(alias) === normalize(value)));
}
// Disambiguate common cities only when the person explicitly entered them in the run settings.
const cities: Record<string, string> = {
  vienna: "at", wien: "at", linz: "at", graz: "at", innsbruck: "at", berlin: "de", munich: "de", munchen: "de", hamburg: "de", frankfurt: "de",
  london: "gb", manchester: "gb", edinburgh: "gb", dublin: "ie", paris: "fr", amsterdam: "nl", zurich: "ch",
  toronto: "ca", vancouver: "ca", montreal: "ca", sydney: "au", melbourne: "au", "new york": "us", "san francisco": "us", seattle: "us", boston: "us",
};
export function indeedLocationTarget(location: string, fallbackBase: string) {
  const parts = location.split(",").map(part => part.trim()).filter(Boolean);
  const country = searchCountry(parts.at(-1) ?? "") ?? searchCountry(cities[normalize(location)] ?? "");
  const base = country ? `https://${country[1]}.indeed.com` : fallbackBase;
  // The country code decides the local search language; a fallback base such as https://at.indeed.com still maps to "at".
  const countryCode = country?.[0] ?? searchCountry(new URL(base).hostname.split(".")[0] === "www" ? "us" : new URL(base).hostname.split(".")[0])?.[0] ?? "us";
  return { base, countryCode, location: country && parts.length === 1 && searchCountry(location) ? country[2] : location };
}

/** Country aliases match source country codes, but never infer a preference from a CV or description. */
export function matchesJobLocation(jobLocation: string, requested: string): boolean {
  const parts = requested.split(",").map(part => part.trim()).filter(Boolean);
  if (parts.length > 1) return parts.every(part => matchesJobLocation(jobLocation, part));
  const country = searchCountry(requested);
  if (!country) {
    const equivalents = [["vienna", "wien"], ["munich", "munchen"]].find(group => group.includes(normalize(requested))) ?? [normalize(requested)];
    return equivalents.some(city => normalize(jobLocation).includes(city));
  }
  const [code, , name, ...aliases] = country;
  return jobLocation.split(/[^A-Za-z]+/).includes(code.toUpperCase()) || [name, ...aliases].some(alias =>
    (` ${normalize(jobLocation).replace(/[^a-z0-9]+/g, " ")} `).includes(` ${normalize(alias).replace(/[^a-z0-9]+/g, " ")} `));
}
