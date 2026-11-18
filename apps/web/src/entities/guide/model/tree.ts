import treeJson from './tree.json';

/**
 * A node of the "systems and roles" focus tree (legacy `public/data/tree.json`, copied as is).
 * Static content shipped with the app; the texts are Uzbek, as in legacy, and are not translated.
 */
export interface GuideNode {
  id: string;
  title: string;
  /** Short explanation shown under the node ("Hint / Izoh"). */
  hint?: string;
  /** A leaf with a url opens the system in a new tab. */
  url?: string;
  children?: GuideNode[];
}

export const GUIDE_TREE: readonly GuideNode[] = treeJson;

export function hasChildren(node: GuideNode): node is GuideNode & { children: GuideNode[] } {
  return Array.isArray(node.children) && node.children.length > 0;
}

/** Only https links are rendered as links (the legacy page put any url into `href`). */
export function safeUrl(node: GuideNode): string | null {
  if (hasChildren(node) || !node.url) return null;
  try {
    return new URL(node.url).protocol === 'https:' ? node.url : null;
  } catch {
    return null;
  }
}
