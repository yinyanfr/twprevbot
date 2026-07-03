import assert from "node:assert/strict";
import test from "node:test";
import {
  extractYouTubeUrls,
  parseYouTubeVideoUrl,
} from "../libs/youtube-url.js";

test("extracts youtube watch short and shorts urls", () => {
  assert.deepEqual(
    extractYouTubeUrls(
      "https://www.youtube.com/watch?v=dQw4w9WgXcQ https://youtu.be/9bZkp7q19f0 https://www.youtube.com/shorts/aqz-KE-bpKQ",
    ),
    [
      {
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
      {
        videoId: "9bZkp7q19f0",
        url: "https://www.youtube.com/watch?v=9bZkp7q19f0",
      },
      {
        videoId: "aqz-KE-bpKQ",
        url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
      },
    ],
  );
});

test("ignores playlist links and trailing punctuation", () => {
  assert.deepEqual(
    extractYouTubeUrls(
      "(https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123) https://www.youtube.com/playlist?list=PL123 https://youtu.be/dQw4w9WgXcQ.",
    ),
    [
      {
        videoId: "dQw4w9WgXcQ",
        url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
      },
    ],
  );
});

test("parses canonical youtube video urls", () => {
  assert.deepEqual(parseYouTubeVideoUrl("https://youtu.be/dQw4w9WgXcQ?t=43"), {
    videoId: "dQw4w9WgXcQ",
    url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
  });
  assert.deepEqual(
    parseYouTubeVideoUrl("https://m.youtube.com/watch?v=aqz-KE-bpKQ"),
    {
      videoId: "aqz-KE-bpKQ",
      url: "https://www.youtube.com/watch?v=aqz-KE-bpKQ",
    },
  );
  assert.equal(
    parseYouTubeVideoUrl("https://www.youtube.com/playlist?list=PL123"),
    null,
  );
});
