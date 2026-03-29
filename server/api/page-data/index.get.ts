import { marked } from "marked";
import type { MarkedExtension } from "marked";
import DOMPurify from "isomorphic-dompurify";

const markedLinkNewTab: MarkedExtension = {
  renderer: {
    link({ href, text }) {
      return `<a href="${href}" target="_blank" rel="noopener noreferrer">${text}</a>`;
    },
  },
};

marked.use(markedLinkNewTab);

export default defineEventHandler(async () => {
  const config = useRuntimeConfig();
  const yggdrasilBaseUrl = config.yggdrasilBaseUrl || "http://localhost:12042";

  const announcementRaw = getSetting("general.announcement");
  const announcementText = typeof announcementRaw === "string" ? announcementRaw : "";
  const announcementHtml = announcementText
    ? DOMPurify.sanitize(await marked.parse(announcementText))
    : "";

  return {
    announcement: announcementHtml,
    yggdrasilApiUrl: `${yggdrasilBaseUrl}/api/yggdrasil`,
  };
});
