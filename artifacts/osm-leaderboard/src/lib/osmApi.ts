// OSM Changeset API utility

export interface Changeset {
  id: string;
  uid: number | null; // numeric OSM user id, from the changeset's own `uid` attribute
  created_at: string;
  changes_count: number;
  min_lat?: number;
  min_lon?: number;
  max_lat?: number;
  max_lon?: number;
  comment: string;
  hashtagsTag: string[]; // from the dedicated `hashtags` changeset tag (lowercased)
}

const PAGE_SIZE = 100;
// Safety cap on total changesets paged through per user. Without this, a
// heavy mapper (e.g. 15k+ lifetime changesets) makes an "All Time" query
// page back through their entire history and download a diff per changeset,
// which is impractical from the browser. See 2026-08-13 maintenance notes.
const MAX_CHANGESETS = 1000;

function parseChangesetPage(xmlText: string): Changeset[] {
  const doc = new DOMParser().parseFromString(xmlText, "text/xml");
  const changesetElements = doc.querySelectorAll("changeset");
  const changesets: Changeset[] = [];

  changesetElements.forEach(el => {
    const id = el.getAttribute("id") || "";
    const uidAttr = el.getAttribute("uid");
    const uid = uidAttr ? parseInt(uidAttr, 10) : null;
    const created_at = el.getAttribute("created_at") || "";
    const changes_count = parseInt(el.getAttribute("changes_count") || "0", 10);

    const min_lat = el.hasAttribute("min_lat") ? parseFloat(el.getAttribute("min_lat")!) : undefined;
    const min_lon = el.hasAttribute("min_lon") ? parseFloat(el.getAttribute("min_lon")!) : undefined;
    const max_lat = el.hasAttribute("max_lat") ? parseFloat(el.getAttribute("max_lat")!) : undefined;
    const max_lon = el.hasAttribute("max_lon") ? parseFloat(el.getAttribute("max_lon")!) : undefined;

    let comment = "";
    let hashtagsTag: string[] = [];

    el.querySelectorAll("tag").forEach(tag => {
      const k = tag.getAttribute("k");
      const v = tag.getAttribute("v") || "";
      if (k === "comment") {
        comment = v;
      } else if (k === "hashtags") {
        // OSM API auto-derives this tag from the comment, semicolon-separated
        hashtagsTag = v.split(";").map(h => h.trim().toLowerCase()).filter(Boolean);
      }
    });

    changesets.push({
      id, uid, created_at, changes_count, min_lat, min_lon, max_lat, max_lon, comment, hashtagsTag
    });
  });

  return changesets;
}

/**
 * Fetch a user's changesets, paginating back through history via the `time`
 * range parameter. When `sinceDate` is given, paging stops as soon as a page's
 * oldest changeset predates it (the caller still filters the returned list).
 */
export async function fetchUserChangesets(username: string, sinceDate?: Date | null): Promise<Changeset[]> {
  const results: Changeset[] = [];
  let beforeIso: string | undefined;

  try {
    while (results.length < MAX_CHANGESETS) {
      const params = new URLSearchParams({ display_name: username, limit: String(PAGE_SIZE) });
      // The OSM API's open-ended "before" pagination requires an explicit lower bound.
      if (beforeIso) params.set("time", `2001-01-01T00:00:00Z,${beforeIso}`);

      const response = await fetch(`https://api.openstreetmap.org/api/0.6/changesets?${params.toString()}`);
      if (!response.ok) {
        if (response.status === 404) break; // User might not have changesets or doesn't exist
        throw new Error(`Failed to fetch changesets for ${username}: ${response.statusText}`);
      }

      const page = parseChangesetPage(await response.text());
      if (page.length === 0) break;
      results.push(...page);

      if (page.length < PAGE_SIZE) break; // last page reached

      const oldest = page[page.length - 1]; // API returns newest-first
      if (sinceDate && new Date(oldest.created_at) < sinceDate) break; // paged past the requested window
      beforeIso = oldest.created_at;
    }

    return results.slice(0, MAX_CHANGESETS);
  } catch (error) {
    console.error(`Error fetching changesets for ${username}:`, error);
    throw error;
  }
}

/**
 * Resolve a username to its numeric OSM user id via a single-changeset fetch.
 * Cheaper than paginating a user's full changeset history just to read `uid`
 * off the first page. Returns null if the user has no changesets (or doesn't exist).
 */
export async function fetchUserId(username: string): Promise<number | null> {
  const params = new URLSearchParams({ display_name: username, limit: "1" });
  const response = await fetch(`https://api.openstreetmap.org/api/0.6/changesets?${params.toString()}`);
  if (!response.ok) return null;
  const [first] = parseChangesetPage(await response.text());
  return first?.uid ?? null;
}

/**
 * Exact, uncapped lifetime changeset count for a user, straight from the OSM
 * user-details endpoint — no pagination needed (unlike fetchUserChangesets,
 * which stops at MAX_CHANGESETS). CORS-enabled, no auth required for a public
 * profile. Returns null on failure (network error, or a user who has opted
 * their profile out of public visibility) so callers can fall back.
 */
export async function fetchUserTotalChangesetCount(uid: number): Promise<number | null> {
  try {
    const response = await fetch(`https://api.openstreetmap.org/api/0.6/user/${uid}.json`);
    if (!response.ok) return null;
    const data = await response.json();
    const count = data?.user?.changesets?.count;
    return typeof count === "number" ? count : null;
  } catch (error) {
    console.error(`Error fetching user details for uid ${uid}:`, error);
    return null;
  }
}
