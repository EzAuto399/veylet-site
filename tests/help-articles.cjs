'use strict';
/*
 * The help centre's single source. Every article is written once here and rendered twice:
 *
 * - /help/<slug>      public, indexable, with a canonical URL, a description and JSON-LD;
 * - /app/help/<slug>  the same words for the Veylet Capture app: noindex, no marketing
 *                     navigation, links only to /app pages, no price, pack or way to buy
 *                     (scripts/check-app-pages.mjs; App Store Guideline 3.1.1).
 *
 * Every recapture rule and review flag has a page at fix/<rule>, so the app and the desk can
 * deep-link by rule id. The advisory flags share one article (fix/worth-a-look, a section
 * per rule, id = rule); fix/<flag> is a one-line redirect to its section.
 *
 * The words follow docs/render-status-contract-20260925.md in property-3d-studio: processing
 * is automatic, step 5 "Checking quality" is an automatic check, and no person or studio
 * checks a walkthrough.
 *
 * tests/help-pages.test.cjs fails when dist differs from what this renders. After editing:
 *   node tests/help-articles.cjs --write
 */
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');

const DIST = path.join(__dirname, '../dist');
const ORIGIN = 'https://veylet.com';
// The support address every page on the site uses (dist/support, dist/app/support).
const SUPPORT = 'yoda@yodalai.xyz';

// The rule ids the app and the desk know (cloud/quality_gate.py RULES; account.js REVIEW_FLAG_WORDS).
const RECAPTURE_RULES = ['no_frames', 'no_depth', 'upload_limits', 'phone_budget', 'not_property'];
const FLAG_RULES = ['photo_match', 'coverage', 'few_views', 'floaters', 'no_floor', 'not_connected', 'ai_visual'];
const FLAG_ARTICLE = 'fix/worth-a-look';

const GROUPS = [
  { id: 'getting-started', title: 'Getting started', summary: 'The device you need, signing in, and the practice room.' },
  { id: 'capturing', title: 'Capturing', summary: 'Walking a room so every view connects, from the first spot to the last doorway.' },
  { id: 'sending', title: 'Sending and rendering', summary: 'The upload, and what each status means while your walkthrough is made.' },
  { id: 'fixing', title: 'Fixing a capture', summary: 'Each reason a capture comes back, and the fix. The names match the ones the app shows.' },
  { id: 'sharing', title: 'Reviewing and sharing', summary: 'Approving, sharing, your website, and what your client sees.' },
  { id: 'account', title: 'Privacy and your account', summary: 'Permission and privacy, your plan, and deleting your account.' },
];

/*
 * Inline marks: [label](target) and **strong**. Targets: help (the index), help:<slug>[#id],
 * account, privacy, terms, support, website-guide. Each resolves per edition.
 */
const EDITIONS = {
  public: { base: '/help', account: '/account', privacy: '/privacy', terms: '/terms', support: '/support', 'website-guide': '/website-guide' },
  app: { base: '/app/help', account: '/app/account', privacy: '/app/privacy', terms: '/app/terms', support: '/app/support', 'website-guide': '/app/help/website' },
};

const ARTICLES = [
  // ---- Getting started ------------------------------------------------------------------
  {
    slug: 'what-you-need', group: 'getting-started', title: 'What you need to start', short: 'What you need',
    description: 'The iPhone or iPad Veylet Capture needs, how much free space to keep, and what to have ready before your first capture.',
    lead: 'Veylet Capture records rooms with the LiDAR camera on a Pro iPhone or iPad. Check these before your first capture.',
    body: [{ steps: [
      '**A LiDAR device:** an iPhone 12 Pro or a later Pro model, or an iPad Pro with LiDAR. Other iPhones cannot record a capture.',
      '**Free space:** keep at least 3 GB free. A capture cannot start with less than 2 GB.',
      '**An email address** for your Veylet account. There is no password.',
      '**About five minutes** in one room at home for the [practice room](help:practice-room).',
      '**For a real home:** permission to capture it, working lights, and a clear route through each room.',
    ] }],
    notWorking: [
      'In the app, open **Account**. It says "Ready to capture" when your device has the LiDAR camera Veylet needs. If it says the device has no rear LiDAR camera, that device cannot record; use a Pro model.',
      'If Account warns that space is low, delete videos or apps you no longer need, then try again.',
    ],
  },
  {
    slug: 'install-and-sign-in', group: 'getting-started', title: 'Install the app and sign in', short: 'Install and sign in',
    description: 'Install Veylet Capture, then sign in with an email link. No password, and the first link creates your account.',
    lead: 'You sign in with a link sent to your email. There is no password, and the first link also creates your account.',
    body: [{ steps: [
      'Install **Veylet Capture** on your Pro iPhone or iPad, from the App Store or the invitation link Veylet sent you.',
      'Open it. You can read how it works and do the practice room before you sign in.',
      'When asked, enter your email address. Use the same email you use for your Veylet account on the website.',
      'Open the email on the same iPhone and tap the link. You come back to the app, signed in.',
    ] }],
    notWorking: [
      'No email after a minute? Check your junk folder, then send it again from the app.',
      'If the link opens somewhere other than the app, go back to the app and choose **Continue in browser** to sign in there instead.',
      'Sign-in links work once. If one has already been used, send a new one.',
    ],
  },
  {
    slug: 'practice-room', group: 'getting-started', title: 'The practice room, and how to pass it', short: 'Practice room',
    description: 'Practise in one room at home before your first real capture: the four checks, what "Room done" means and what to do if it is not done yet.',
    lead: 'Before your first real capture, you practise in one room at home. It takes about five minutes, nothing leaves your iPhone, and your first real capture unlocks when the room is done.',
    body: [{ steps: [
      'Open the practice room and pick an ordinary room at home. Turn the lights on.',
      'Stand in the middle and make one slow, level circle: about 36 seconds, pausing whenever views stop saving. This is the **Full turn at one spot** check.',
      'Tilt the phone about 30 degrees up and make another slow circle, then tilt about 30 degrees down and make a third. These are the **Circle tilted up** and **Circle tilted down** checks.',
      'Walk out through the doorway in small steps, showing both edges of the door frame from both sides.',
      'Tap **Finish & save**, then confirm you showed both doorway edges.',
      '**Room done** means every check passed. Your first real capture is now unlocked.',
    ] }],
    notWorking: [
      '**Not done yet:** the screen names the one thing to do next, such as "Tilt thirty degrees up. Make one slow circle." Start another practice capture to finish the missing checks. The first one stays on your iPhone.',
      '**Fast-turn warnings** and **Saving kept up** are advice. They never stop you passing, but slower turns save more views.',
      '**Not measured yet** means the app cannot check that today, such as your distance from the walls.',
      'The turning-speed lesson lets you practise the pace, about ten degrees a second, without the camera.',
    ],
  },

  // ---- Capturing ---------------------------------------------------------------------------
  {
    slug: 'walk-a-room', group: 'capturing', title: 'Walk a room: standing spots, level turns, tilt up and down', short: 'Walk a room', pageTitle: 'How to walk a room for capture',
    description: 'How to capture one room: two standing spots, slow level circles, one circle tilted up and one down, and small connected steps.',
    lead: 'A good capture is a set of connected views from a few standing spots. Turn slowly, keep an edge in view, and let each view save.',
    body: [{ steps: [
      'Turn on the room’s lights. Choose two spots: one near the doorway and one in the middle, about a metre from the walls where you can.',
      'Hold the phone upright at chest height. At each spot, turn one slow, level circle: about 36 seconds, or 9 seconds for each quarter-turn.',
      'Turn a little, wait for a view to save, then turn again. Keep the same corner, door frame or piece of furniture in view.',
      'At the middle spot, tilt about 30 degrees up and make one slow circle. Then tilt about 30 degrees down and make another.',
      'Between spots, walk in small steps of 15 to 20 centimetres, keeping a familiar edge in view.',
    ] }],
    notWorking: [
      'If the app warns you are turning too fast, slow down: views are skipped while you turn quickly.',
      '**Include an edge:** a blank wall gives the app nothing to match. Point at a corner, door frame or furniture.',
      '**Add light:** the view is too dark for detail. Turn on a light or open the door.',
      '**Small rooms** like bathrooms and halls: sweep slowly from the doorway or a corner. Full circles are optional where there is no room to turn.',
      'A capture saves up to 300 views. For a bigger home, see [a whole home, room by room](help:whole-home).',
    ],
  },
  {
    slug: 'doorways', group: 'capturing', title: 'Doorways and joining rooms', short: 'Doorways',
    description: 'How to cross a doorway so the rooms join up in the walkthrough, and how to finish the route.',
    lead: 'Rooms join up in the walkthrough only where the capture saw the doorway from both sides. Cross slowly, with the door frame in view.',
    body: [{ steps: [
      'Before you leave a room, show both edges of its doorway from inside.',
      'Cross in small steps, keeping the door frame in view. Don’t step through and then spin around.',
      'From the other side, show both edges of the doorway again.',
      'In a whole-home capture, tap **Next room** at the doorway and name the room you are entering.',
      'At the end, walk back on a slightly different clear path and finish facing the view you started with.',
    ] }],
    notWorking: [
      'If the phone check says **Close the break in your route**, walk that stretch again slowly with a familiar doorway or corner in sight.',
      'If the review says walking on to the next room may not work, see [the path between rooms](help:fix/worth-a-look#not_connected).',
      'Keep doors in the same position until you finish. A door that moves between views confuses the join.',
    ],
  },
  {
    slug: 'light-mirrors-windows', group: 'capturing', title: 'Light, mirrors and windows', short: 'Light, mirrors and windows',
    description: 'Lighting a room for capture, and how to handle mirrors, glass, windows and blank walls.',
    lead: 'Even light and surfaces with detail give the sharpest walkthrough. Mirrors and glass reflect, so give them less of the view.',
    body: [{ steps: [
      'Turn on every light before you start, and keep lights, doors and furniture unchanged until you finish the room.',
      'Point toward textured furniture, frames or a doorway rather than straight at a mirror or a blank wall.',
      'Face mirrors, glass doors and large windows at an angle, with a frame or wall edge in the view. Reflections move as you move, and the 3D model cannot place them.',
      'Check mirrors for yourself and anyone else in the room. Anything reflected can appear in the walkthrough.',
    ] }],
    notWorking: [
      '**Add light** appears when a view is too dark for detail. Turn on a light or open the door.',
      'The phone check does not judge lighting, reflections or sharpness. The automatic check after upload does, and may flag an area as [worth a look](help:fix/worth-a-look).',
    ],
  },
  {
    slug: 'whole-home', group: 'capturing', title: 'A whole home, room by room', short: 'Whole home',
    description: 'Capture a whole home one room at a time: create the listing, name each room at its doorway, and finish with the phone check.',
    lead: 'A whole home is captured one room at a time in one capture. It takes about 3 minutes a room.',
    body: [{ steps: [
      'Create a new listing. Give it a name you will recognise, not the full address, and choose the whole home.',
      'Start in the first room and capture it as usual: see [walk a room](help:walk-a-room).',
      'At each doorway, tap **Next room** and name the room: Living, Kitchen, Bedroom, Bathroom, Hall, or Other for any name up to 32 characters.',
      'Carry on room by room, crossing each doorway slowly.',
      'After the last room, tap **Finish & save**. The phone check looks at every room.',
    ] }],
    notWorking: [
      'A capture holds up to 300 views. If it reaches the limit or its room limit, finish it and capture the other rooms as a new capture.',
      'If a home is too big for one walkthrough, it may come back as [too large for a phone](help:fix/phone_budget). Split it into two captures.',
      'If a room comes back as **Needs recapture** after rendering, tap **Recapture** and the room’s name. The capture starts in that room.',
    ],
  },
  {
    slug: 'phone-check', group: 'capturing', title: 'What the phone check means', short: 'Phone check',
    description: 'The check the app runs on your phone when you stop capturing: Ready to send, Recapture advised and Not enough views yet, and what to do next.',
    lead: 'When you stop capturing, the app checks the views saved on your phone before you finish. It cannot judge the final 3D quality; that is checked automatically after the upload.',
    body: [{ terms: [
      ['Ready to send', 'Enough connected views were saved. Tap **Finish & save**, then **Send to Veylet**.'],
      ['Recapture advised', 'Something listed needs fixing. Tap **Keep capturing** and fix it while you are still in the room. **Finish anyway** saves it as it is, and a finished capture cannot be extended.'],
      ['Not enough views yet', 'Fewer than three views were saved, so nothing can be sent. Tap **Keep capturing**.'],
    ] }, { paras: [
      'In a whole-home capture, each room shows whether it is done, and you confirm you showed both doorway edges.',
      'The phone check does not judge lighting, reflections, mirrors or how sharp each photo is.',
    ] }],
    notWorking: [
      '**Close the break in your route:** walk that stretch again slowly with a doorway or corner in sight.',
      '**Pause and sweep from one spot:** every view was saved while walking. Stop and turn slowly in small saved steps.',
      '**Move back toward your last view:** step back until a familiar edge is visible and wait for a view to save.',
      'If most views point up or down, hold the phone level for most of the room and keep a few planned tilted circles.',
    ],
  },

  // ---- Sending and rendering --------------------------------------------------------------
  {
    slug: 'uploading', group: 'sending', title: 'Sending your capture', short: 'Sending',
    description: 'How a capture uploads: Wi-Fi or mobile data, in the background, with pause, resume and cancel.',
    lead: 'After the phone check, **Send to Veylet** uploads the capture. It keeps going in the background, even if you leave the app.',
    body: [{ steps: [
      'Tap **Send to Veylet**. The first time, the app asks to send you notifications. Allow them to hear when your walkthrough is ready.',
      'The upload uses Wi-Fi or mobile data, whichever the phone has. A whole home is large, so Wi-Fi is quicker and saves your data.',
      'You can leave Veylet: sending continues in the background, even if you close the app. Keeping the phone plugged in helps it finish.',
      'The listing shows **Uploading** and how much has been sent. Your original capture stays on the iPhone.',
      'When every part has arrived, it moves to **Waiting to render** by itself.',
    ] }],
    notWorking: [
      '**Sending paused:** tap **Resume sending**. The original is kept on the iPhone.',
      'If the upload window expired before every part arrived, tap **Renew expired upload** or **Retry this job**.',
      '**You’re offline:** the app shows the last status it read and the time. It carries on when you are back online.',
      'To stop, tap **Cancel job**. Your original capture stays on the iPhone.',
    ],
  },
  {
    slug: 'render-status', group: 'sending', title: 'What each status means', short: 'Statuses',
    description: 'Uploading, Waiting to render, Rendering steps 1 to 5, Retrying, Needs recapture and Failed: what each means and whether you need to do anything.',
    lead: 'Rendering and the quality check are automatic. A walkthrough is usually ready 1 to 2 hours after the upload finishes.',
    body: [{ terms: [
      ['Uploading', 'The capture is still being sent; the percentage shows how much has arrived. Nothing to do. See [sending your capture](help:uploading).'],
      ['Waiting to render', 'Your capture is in line, with your place and the usual start time. Instead of a place, it may say why it is waiting:', [
        '"We’ll start your render as soon as a rendering place opens for your account."',
        '"Rendering is paused for a moment. Yours keeps its place in line."',
        '"You’ve used this week’s renders." It starts on the day shown.',
      ], 'None of these is a fault. It starts by itself.'],
      ['Rendering', 'Five steps: 1 Preparing photos, 2 Lining up camera positions, 3 Building your 3D walkthrough, 4 Packing it for phones, 5 Checking quality. Step 5 is an automatic check of the finished walkthrough.'],
      ['Retrying', 'Rendering hit a snag, so it is trying again automatically (attempt 2 of 2). Nothing to do.'],
      ['Needs recapture', 'A room could not be used. Each room shows its reason and the fix, and recapturing it won’t use a walkthrough. See [fixing a capture](help#fixing).'],
      ['Failed', 'Something went wrong on Veylet’s side. Veylet support has been told, and nothing was used.'],
    ] }, { paras: [
      'When it passes, the listing reads **Ready for your review**. See [approve and share](help:approve-and-share).',
    ] }],
    notWorking: [
      '**Still working, checking in** means the renderer has not reported for a few minutes. Veylet support has been alerted; there is nothing for you to do.',
      'If a render has waited much longer than its usual start time with no hold shown, email Veylet support with the listing’s name as it appears in the app.',
    ],
  },

  // ---- Fixing a capture (rule ids) ------------------------------------------------------------
  {
    slug: 'fix/no_frames', group: 'fixing', rule: 'no_frames', title: 'No usable photos were saved', short: 'No usable photos',
    description: 'Why a capture came back with no usable photos, and how to capture it so views save as you go.',
    lead: 'The capture reached Veylet with fewer than three usable photos, so nothing could be built. The fix is to walk slowly and turn a full circle at each spot, so Veylet can save photos as you go.',
    body: [{ steps: [
      'Capture the room again with the lights on.',
      'Hold the phone upright and point it at a corner or door frame until views start saving.',
      'Walk slowly and turn a full circle at each spot, waiting for each view to save.',
      'Finish, check the phone check says **Ready to send**, then tap **Send to Veylet**.',
    ] }],
    notWorking: [
      'If the phone check says **Not enough views yet**, fewer than three photos were saved. Hold the phone level on a clear corner or doorway until views start saving.',
      'If the camera view stays black or frozen, close the app fully, open it again and retry.',
      'Recapturing won’t use a walkthrough.',
    ],
  },
  {
    slug: 'fix/no_depth', group: 'fixing', rule: 'no_depth', title: 'The capture has no depth readings', short: 'No depth readings',
    description: 'Why a capture came back without depth, and how to capture it on an iPhone or iPad with LiDAR.',
    lead: 'The capture has no depth readings, so a 3D walkthrough cannot be built. Capture on an iPhone or iPad with LiDAR (a Pro model), so every photo has depth.',
    body: [{ steps: [
      'Check the device: an iPhone 12 Pro or a later Pro model, or an iPad Pro with LiDAR. In the app, **Account** says "Ready to capture" on a device that can record.',
      'Make sure nothing covers the rear cameras or the LiDAR sensor beside them: no case edge, finger or dirt.',
      'Capture the room again with Veylet Capture, then send it.',
    ] }],
    notWorking: [
      'If Account says the device has no rear LiDAR camera, that device cannot record a capture. See [what you need](help:what-you-need).',
      'Recapturing won’t use a walkthrough.',
    ],
  },
  {
    slug: 'fix/upload_limits', group: 'fixing', rule: 'upload_limits', title: 'The capture is larger than Veylet can accept', short: 'Too large to accept',
    description: 'Why a capture was too big to accept, and how to split a home into smaller captures.',
    lead: 'The capture is larger than Veylet can accept in one go. Capture fewer rooms at a time, and send the rest as another capture.',
    body: [{ steps: [
      'Decide where to split the home, for example the living areas in one capture and the bedrooms in another.',
      'Capture the first group of rooms and send it.',
      'Start a new capture for the remaining rooms and send that too.',
    ] }],
    notWorking: [
      'Keep each room to what it needs: two standing spots and three circles are enough for an ordinary room. See [walk a room](help:walk-a-room).',
      'Recapturing won’t use a walkthrough.',
    ],
  },
  {
    slug: 'fix/phone_budget', group: 'fixing', rule: 'phone_budget', title: 'The walkthrough is too large for a phone', short: 'Too large for a phone',
    description: 'Why a walkthrough was too large to open smoothly on a phone, and how to capture fewer rooms in one walkthrough.',
    lead: 'The finished walkthrough would be too large to open smoothly on a phone. Veylet has already tried once more automatically. Capture fewer rooms in one walkthrough.',
    body: [{ steps: [
      'Split the home into two captures, for example the living areas and the bedrooms.',
      'Capture each group of rooms as its own capture, with its own name.',
      'Send each one. Each becomes its own walkthrough, small enough for a phone.',
    ] }],
    notWorking: [
      'Very large open-plan spaces count as big too. Keep to two standing spots and three circles in each.',
      'Recapturing won’t use a walkthrough.',
    ],
  },
  {
    slug: 'fix/not_property', group: 'fixing', rule: 'not_property', title: 'The capture doesn’t look like a property', short: 'Not a property',
    description: 'Why a capture was not accepted as the inside of a property, and what to capture instead.',
    lead: 'This capture does not look like the inside of a property. Capture the rooms inside the home you’re listing.',
    body: [{ steps: [
      'Capture indoor rooms of the home you are listing, not a screen, a photo or the view outside.',
      'Walk each room from its standing spots with the lights on, keeping walls, doorways and furniture in view.',
      'Send the new capture.',
    ] }],
    notWorking: [
      'If you did capture the inside of a home, email Veylet support with the listing’s name as it appears in the app.',
      'Recapturing won’t use a walkthrough.',
    ],
  },
  {
    slug: FLAG_ARTICLE, group: 'fixing', title: 'Worth a look before you share', short: 'Worth a look',
    description: 'The automatic check’s advice on your walkthrough: blurry areas, missing corners, thin detail, smudges, the floor and the path between rooms.',
    lead: 'The automatic quality check may list a few areas as worth a look. It is advice only: it never stops you approving. Walk through each area, then decide.',
    body: [
      { id: 'photo_match', title: 'Some areas may look blurry', paras: [
        'The walkthrough does not match the photos closely enough there, usually because the phone moved during a photo. Walk to that area and look at edges and text.',
        '**Next time:** move slowly and hold the phone steady, waiting for each view to save.',
      ] },
      { id: 'coverage', title: 'Some corners may be missing', paras: [
        'Parts of the room were not photographed from where you stood. Look for gaps or smears at corners and behind furniture.',
        '**Next time:** turn a full circle at each spot, and add a spot where furniture hides a corner.',
      ] },
      { id: 'few_views', title: 'Few photos were taken here, so detail may be thin', paras: [
        'Only a few views were saved in that room. Look for soft or patchy walls.',
        '**Next time:** walk slowly and turn a full circle at each spot.',
      ] },
      { id: 'floaters', title: 'There may be stray smudges in the air', paras: [
        'Small cloudy blobs can float in mid-air. Look around the room at eye level.',
        '**Next time:** keep the lights on and nothing moving, including people, pets, doors and curtains.',
      ] },
      { id: 'no_floor', title: 'The floor may be hard to walk on', paras: [
        'The check could not find a clear floor there, so tapping to walk may not work. Try walking around that room.',
        '**Next time:** tilt down for one slow circle so the floor and doorways are included.',
      ] },
      { id: 'not_connected', title: 'Walking on to the next room may not work', paras: [
        'The check could not find a clear path on the floor from that room to the others. Try walking through the doorway.',
        '**Next time:** show the doorway from both sides and the floor between the rooms. See [doorways](help:doorways).',
      ] },
      { id: 'ai_visual', title: 'An automatic check noticed something to look at', paras: [
        'An automatic visual check of the finished walkthrough found something unusual in that room. Walk through it and look closely.',
        '**Next time:** move slowly with the phone steady and the lights on.',
      ] },
    ],
    notWorking: [
      'If an area looks fine, approve and share as usual. Your client never sees this advice.',
      'If it isn’t good enough to share, don’t approve it. Capture the listing again with the fix above and send it, or email Veylet support first if you are unsure which rooms to redo.',
    ],
  },

  // ---- Reviewing and sharing ------------------------------------------------------------------
  {
    slug: 'approve-and-share', group: 'sharing', title: 'Approve and share: the seven checks', short: 'Approve and share',
    description: 'How to review a ready walkthrough on your phone, the five checks and two permissions, and what one press of Approve and share does.',
    lead: 'When a walkthrough is **Ready for your review**, you walk it on your phone, tick seven checks and press **Approve and share** once. Nothing is shared before that.',
    body: [{ steps: [
      'Tap the **Ready for your review** notification, or open the listing and tap **Review walkthrough**.',
      'Walk through every room on your phone. Read any areas listed as [worth a look](help:fix/worth-a-look) and check them.',
      'Tick each check that is true (see the list below). Leave one off if something needs fixing.',
      'Press **Approve and share** and confirm. Anyone with the link can open it and forward it; it stays online while your plan runs and at least 12 months after that day.',
      'The listing now reads **Live**. Share it: see [share your walkthrough](help:share-your-walkthrough).',
    ] }, { title: 'The seven checks', terms: [
      ['Coverage', 'Every included room and required surface is present.'],
      ['Alignment', 'Walls, furniture and edges stay aligned while turning.'],
      ['Navigation', 'Viewpoints and movement do not cross walls or expose broken areas.'],
      ['Privacy', 'People, documents, screens and excluded areas have been checked.'],
      ['Phone', 'This exact tour has been checked on a physical phone.'],
      ['Capture permission', 'I have the property’s permission for this capture.'],
      ['Permission to publish', 'I have permission to publish and share this exact tour.'],
    ] }],
    notWorking: [
      'The button stays off until all seven checks are ticked.',
      '**Approved. Sharing waits for** a reason: the card names the one fix, such as someone with sharing permission. Your approval is kept.',
      'You can also review in [your Veylet account](account) on a computer, with the same checks.',
    ],
  },
  {
    slug: 'share-your-walkthrough', group: 'sharing', title: 'Share your walkthrough: link, QR code, embed and listing URL', short: 'Share your walkthrough', pageTitle: 'Share a walkthrough: link, QR code, embed',
    description: 'Ways to share a live walkthrough: the link, a QR code for print, the embed code for your website, and the listing URL for portals and your CRM.',
    lead: 'A live walkthrough has one link and four ways to hand it out. Use the one that suits where your client will see it.',
    body: [{ terms: [
      ['Share or Copy link', 'Sends the link by Messages, Mail, AirDrop or any app. Anyone with it can open or forward the walkthrough.'],
      ['QR code', '**Show QR code** for someone beside you to scan. In your account, **Download QR code (PNG)** for a window card or brochure.'],
      ['Embed code', '**Copy embed code** and paste it into your website’s custom HTML block. See [put it on your website](help:website).'],
      ['Listing URL (portals, CRM)', 'In [your Veylet account](account), **Copy listing URL (portals, CRM)** and paste it into a portal’s virtual tour field or your CRM. It shows the walkthrough only: no contact card, links or QR code.'],
    ] }, { paras: [
      '**Open as your client** shows the page exactly as the person you send it to will see it.',
    ] }],
    notWorking: [
      'Listing portals do not accept the embed code. Use the listing URL there instead.',
      'If a link shows "not available", sharing is paused or turned off. See [pause or turn off sharing](help:pause-or-turn-off).',
    ],
  },
  {
    slug: 'pause-or-turn-off', group: 'sharing', title: 'Pause or turn off sharing', short: 'Pause or turn off',
    description: 'The difference between pausing sharing, which keeps the same link, and turning it off, which ends the link for good.',
    lead: 'Pause keeps the same link for later. Turn off ends the link for good. Both are under **Manage sharing** on the walkthrough’s card in your account.',
    body: [{ terms: [
      ['Pause sharing', 'Within a minute, the link, embed and QR code show "not available". The link stays the same, so printed QR codes work again when you resume.'],
      ['Resume sharing', 'Within a minute, the same link, embed and QR code open the walkthrough again.'],
      ['Turn off sharing', 'Stops the link, its embed and any printed QR code for good. You confirm it first. Turning sharing back on makes a new link, and copies someone already downloaded cannot be recalled.'],
    ] }, { steps: [
      'Open [your Veylet account](account) and find the walkthrough’s card.',
      'Open **Manage sharing**.',
      'Choose **Pause sharing** for a break, or **Turn off sharing** to end the link.',
    ] }],
    notWorking: [
      'After turning sharing off, remove the old link and embed from your listing and website too.',
      'Changes reach viewers within a minute. If a page still shows the walkthrough, reload it.',
    ],
  },
  {
    slug: 'what-your-client-sees', group: 'sharing', title: 'What your client sees, and views and taps', short: 'What your client sees',
    description: 'The page your client opens: the walkthrough, your contact card with Call and Email, and the views and taps your account shows.',
    lead: 'Your client opens a page with the listing’s name, the walkthrough and your contact card. They never need an account or an app.',
    body: [{ title: 'The page', list: [
      'The walkthrough, with a short line: "Captured on site with an iPhone. Not to scale."',
      'Moving around: drag to look, tap the floor or a numbered circle to walk, and use the arrows to go room to room.',
      'Your contact card, with **Call** and **Email** buttons that reach you directly.',
      'A **Share** button, so they can forward it to a partner.',
    ] }, { title: 'Your contact card', paras: [
      'In [your Veylet account](account), under **What your clients see**, enter your name, agency, phone and email, and turn on **Show on shared walkthroughs**. Only what you enter is shown.',
    ] }, { title: 'Views and taps', paras: [
      'Each live walkthrough’s card in your account shows how often it was opened, for example "Opened 3 times", when it was last opened, and how many times people tapped Call and Email. "Not opened yet." means no one has opened it.',
    ] }],
    notWorking: [
      'If your client sees "This walkthrough isn’t available right now", sharing is paused or off. See [pause or turn off sharing](help:pause-or-turn-off).',
      '"This link looks incomplete" means part of the link was lost when it was copied. Send it again.',
      'The listing URL for portals never shows your contact card.',
    ],
  },
  {
    slug: 'website', group: 'sharing', title: 'Put your walkthrough on your website', short: 'Your website',
    description: 'Paste the embed code into WordPress, Squarespace, Wix or Webflow, with the size and plan each builder needs.',
    lead: 'Copy the walkthrough’s embed code, then paste it into a custom HTML block on your page. Here is where that block is in each builder.',
    body: [{ terms: [
      ['WordPress', 'In the block editor, add a **Custom HTML** block, paste the embed code, then Preview and Update. Some page-builder and security plugins strip embeds for non-administrators; ask your site administrator if it disappears.'],
      ['Squarespace', 'Add a **Code** block (not a Markdown block), paste the embed code, keep "Display source" off and save. Code blocks need a Business or Commerce plan.'],
      ['Wix', 'Add **Embed**, then **Embed HTML**, choose Code, paste the embed code and apply. Make the element at least 320 pixels tall, or the button that starts the walkthrough is cut off.'],
      ['Webflow', 'Drag an **Embed** element into the page, paste the embed code and publish. Embeds show only on the published site, not in the designer.'],
    ] }, { paras: [
      'Any other builder: ask for a custom HTML or raw HTML area and paste the code there. Give it at least 320 pixels of height.',
    ] }],
    notWorking: [
      'Blank or cut off? Check the element is at least 320 pixels tall, and check the published page on a phone.',
      'Shows "not available"? Sharing is paused or turned off for that walkthrough.',
      'Listing portals do not accept the embed code. Use the listing URL: see [share your walkthrough](help:share-your-walkthrough).',
    ],
  },

  // ---- Privacy and your account ---------------------------------------------------------------
  {
    slug: 'privacy-and-consent', group: 'account', title: 'Privacy and permission: people, documents and tenants', short: 'Privacy and permission', pageTitle: 'Privacy and permission for captures',
    description: 'What to clear before you capture, the permissions Veylet asks you to confirm, and where the privacy notice explains the rest.',
    lead: 'A walkthrough can show everything the camera saw. Clear the rooms first, and have permission for both the capture and publishing it.',
    body: [{ steps: [
      'Before you capture, ask people and pets to leave the room, and check mirrors for reflections of anyone, including you.',
      'Put away documents, mail, photos, keys, medicines and valuables, and turn off screens.',
      'Get permission from whoever controls the home. If someone lives in it, such as a tenant, get the occupants’ agreement as well as the owner’s.',
      'Before sharing, walk the whole walkthrough and tick the privacy check: people, documents, screens and excluded areas have been checked.',
      'Approve only with both permissions: to capture the home, and to publish and share this exact walkthrough.',
    ] }, { paras: [
      'Veylet cannot give legal advice. The rules for rented homes and personal information depend on your state and your agency, so check with your agency or a legal adviser. How Veylet handles captures and your details is in the [privacy notice](privacy).',
    ] }],
    notWorking: [
      'Found something private after sharing? Pause sharing straight away (see [pause or turn off sharing](help:pause-or-turn-off)), then email Veylet support with the listing’s name.',
      'To have a walkthrough or capture removed, email Veylet support from the address on your account.',
    ],
  },
  {
    slug: 'your-plan', group: 'account', title: 'Your plan: what each state means', short: 'Your plan',
    description: 'The plan states your account shows (Not started, Free months, Active and Ended), and what happens to shared walkthroughs when a plan ends.',
    lead: 'Your account shows one plan state. Here is what each means for your captures and shared walkthroughs.',
    body: [{ terms: [
      ['Not started', 'Your plan has not begun yet. You can practise; renders start once it is running.'],
      ['Free months', 'Your free months are running, with the date they end. Everything works as usual.'],
      ['Active', 'Your plan is running.'],
      ['Ended', 'Your plan or free months ended on the date shown. New captures wait until a plan is running again.'],
    ] }, { paras: [
      'Walkthroughs you already shared stay online for at least 12 months after you approved them, even after a plan ends.',
      'See your plan in the app, under Account. If you subscribed through the App Store, manage or cancel it in your iPhone’s Settings, under your name and then Subscriptions.',
    ] }],
    notWorking: [
      '**Hosting ended** on a walkthrough means its link now shows "not available". Email Veylet support if you need it back online.',
      'Deleting your Veylet account does not cancel an App Store subscription. Cancel it in Settings too.',
    ],
  },
  {
    slug: 'delete-account', group: 'account', title: 'Delete your account', short: 'Delete your account',
    description: 'How to delete your Veylet account from the app or your account online, what is deleted within 30 days, and how to cancel a request.',
    lead: 'You can delete your account in the app or in your account online. Your account, spaces and walkthroughs are deleted within 30 days.',
    body: [{ steps: [
      'In the app, open **Account** and go to **Delete your account**. Online, it is under **Finishing, exporting or leaving** in [your Veylet account](account).',
      'Read what happens: your account, spaces and walkthroughs will be deleted within 30 days, shared links stop working when removal begins, and it cannot be undone.',
      'Tap **Delete my account** and confirm.',
      'It then says "Deletion requested" with the date. Until removal begins, you can still press **Cancel deletion**.',
    ] }, { paras: [
      'Captures saved on your iPhone are not touched. Delete the app to remove them. An App Store subscription is not cancelled by deleting your account; cancel it in Settings.',
    ] }],
    notWorking: [
      'Can’t sign in to delete? Email Veylet support from the address on your account and ask for deletion.',
      'The [privacy notice](privacy) says what is kept after deletion and for how long.',
    ],
  },
];

/* ---- rendering ----------------------------------------------------------------------------- */

const escape = text => String(text).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const plain = text => String(text).replace(/\*\*(.+?)\*\*/g, '$1').replace(/\[([^\]]+)\]\([^)]+\)/g, '$1');
const assetHash = bytes => createHash('sha256').update(bytes).digest('hex').slice(0, 16);

function href(target, edition) {
  const links = EDITIONS[edition];
  if (target === 'help') return links.base;
  if (target.startsWith('help#')) return links.base + target.slice(4);
  if (target.startsWith('help:')) return links.base + '/' + target.slice(5);
  if (links[target]) return links[target];
  throw new Error('Unknown link target: ' + target);
}

function inline(text, edition) {
  let html = escape(text);
  html = html.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  return html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, label, target) => `<a href="${escape(href(target, edition))}">${label}</a>`);
}

function block(section, edition, level = 'h2') {
  const parts = [];
  if (section.title) parts.push(`<${level}${section.id ? ` id="${section.id}"` : ''}>${inline(section.title, edition)}</${level}>`);
  if (section.steps) parts.push('<ol class="help-steps">' + section.steps.map(step => `<li>${inline(step, edition)}</li>`).join('') + '</ol>');
  if (section.list) parts.push('<ul>' + section.list.map(item => `<li>${inline(item, edition)}</li>`).join('') + '</ul>');
  if (section.terms) {
    parts.push('<dl class="help-terms">' + section.terms.map(([term, ...rest]) => {
      const detail = rest.map(item => Array.isArray(item) ? '<ul>' + item.map(line => `<li>${inline(line, edition)}</li>`).join('') + '</ul>' : inline(item, edition));
      return `<div><dt>${inline(term, edition)}</dt><dd>${detail.join(' ')}</dd></div>`;
    }).join('') + '</dl>');
  }
  if (section.paras) parts.push(section.paras.map(para => `<p>${inline(para, edition)}</p>`).join(''));
  const labelled = section.title && section.id ? ` id="section-${section.id}" aria-labelledby="${section.id}"` : '';
  return `<section${labelled}>${parts.join('')}</section>`;
}

function stylesheets(prefix = '') {
  const version = file => assetHash(fs.readFileSync(path.join(DIST, file)));
  return ['style.css', 'guides.css', 'help/help.css'].map(file => `${prefix}<link rel="stylesheet" href="/${file}?v=${version(file)}">`).join('\n');
}

function mailto(subject) {
  return `mailto:${SUPPORT}?subject=${encodeURIComponent(subject)}`;
}

function header(edition) {
  if (edition === 'app') return '<header class="wrap app-header"><span class="brand"><span class="portal" aria-hidden="true"></span>VEYLET</span></header>';
  return '<header class="wrap"><a class="brand" href="/" aria-label="Veylet Studio home"><span class="portal" aria-hidden="true"></span>VEYLET STUDIO</a>'
    + '<nav aria-label="Main"><a href="/#process">How it works</a><a href="/help" aria-current="page">Help</a><a href="/account">Sign in</a></nav></header>';
}

// The public index alone may link to /offer, and only from its footer.
function footer(edition, withOffer = false) {
  if (edition === 'app') {
    return '<footer class="wrap app-footer"><nav aria-label="Account and help"><a href="/app/account">Account</a><a href="/app/help">Help</a>'
      + '<a href="/app/support">Support</a><a href="/app/privacy">Privacy</a><a href="/app/terms">Terms</a></nav></footer>';
  }
  const offer = withOffer ? '<a href="/offer">Offer</a>' : '';
  return '<footer class="wrap"><a class="brand" href="/"><span class="portal" aria-hidden="true"></span>VEYLET STUDIO</a><p>Spaces people can understand.</p>'
    + `<nav aria-label="Footer"><a href="/help">Help</a><a href="/website-guide">Website guide</a><a href="/guides">Guides</a>${offer}<a href="/support">Support</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>`
    + '<span>© 2026 Veylet Studio</span></footer>';
}

function head({ title, description, canonical, edition, jsonLd, extra = '' }) {
  const lines = [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escape(title)}</title>`,
    `<meta name="description" content="${escape(description)}">`,
  ];
  if (edition === 'app') lines.push('<meta name="robots" content="noindex,nofollow">');
  else {
    lines.push(`<link rel="canonical" href="${canonical}">`,
      '<meta property="og:type" content="article">', '<meta property="og:site_name" content="Veylet Studio">', '<meta property="og:locale" content="en_AU">',
      `<meta property="og:title" content="${escape(title)}">`, `<meta property="og:description" content="${escape(description)}">`,
      `<meta property="og:url" content="${canonical}">`, `<meta property="og:image" content="${ORIGIN}/media/share-card.jpg">`,
      '<meta name="twitter:card" content="summary_large_image">');
  }
  lines.push('<meta name="theme-color" content="#10231d">', '<link rel="icon" href="/media/studio-avatar.png">', stylesheets());
  if (extra) lines.push(extra);
  if (jsonLd) lines.push('<script type="application/ld+json">\n' + JSON.stringify(jsonLd, null, 2) + '\n</script>');
  lines.push('</head>');
  return lines.join('\n');
}

const groupOf = article => GROUPS.find(group => group.id === article.group);

function renderArticle(article, edition) {
  const group = groupOf(article);
  const base = EDITIONS[edition].base;
  const canonical = `${ORIGIN}/help/${article.slug}`;
  // The <title> may be shorter than the heading, to stay near 60 characters in search results.
  const title = `${plain(article.pageTitle || article.title)} — Veylet help`;
  const jsonLd = edition === 'public' ? {
    '@context': 'https://schema.org',
    '@graph': [
      { '@type': 'TechArticle', '@id': canonical + '#article', headline: plain(article.title), description: article.description, url: canonical,
        inLanguage: 'en-AU', isPartOf: { '@id': `${ORIGIN}/help#collection` }, publisher: { '@id': `${ORIGIN}/#organization` } },
      { '@type': 'BreadcrumbList', '@id': canonical + '#breadcrumb', itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Help', item: `${ORIGIN}/help` },
        { '@type': 'ListItem', position: 2, name: group.title, item: `${ORIGIN}/help#${group.id}` },
        { '@type': 'ListItem', position: 3, name: plain(article.short) },
      ] },
    ],
  } : null;
  const siblings = ARTICLES.filter(other => other.group === article.group && other.slug !== article.slug);
  const subject = 'Veylet help: ' + plain(article.short);
  const body = [
    `<body class="help-page">`,
    '<a class="skip" href="#main">Skip to content</a>',
    header(edition),
    '<main id="main" class="wrap article-page help-article">',
    `<nav class="crumbs" aria-label="Breadcrumb"><a href="${base}">Help</a><span aria-hidden="true">/</span><a href="${base}#${group.id}">${escape(group.title)}</a><span aria-hidden="true">/</span><span aria-current="page">${escape(plain(article.short))}</span></nav>`,
    `<header class="article-head"><h1>${inline(article.title, edition)}</h1><p class="article-answer">${inline(article.lead, edition)}</p></header>`,
    '<div class="article-body">',
    ...article.body.map(section => block(section, edition)),
    block({ id: 'if-it-does-not-work', title: 'If it doesn’t work', paras: article.notWorking }, edition),
    '</div>',
    '<section class="article-next help-stuck" aria-labelledby="still-stuck">',
    '<h2 id="still-stuck">Still stuck? Email Veylet support</h2>',
    `<p>Write to <a href="${escape(mailto(subject))}">${SUPPORT}</a> and a person replies. Say which step you were on, your iPhone or iPad model, and the app version from Account, then About. Never send passwords or sign-in links.</p>`,
    `<p class="article-actions"><a class="button" href="${escape(mailto(subject))}">Email Veylet support</a></p>`,
    '</section>',
    siblings.length ? `<section class="article-related" aria-labelledby="more-in"><h2 id="more-in">More in ${escape(group.title)}</h2><ul class="guide-list">`
      + siblings.map(other => `<li><a href="${base}/${other.slug}"><span class="guide-list-title">${escape(plain(other.title))}</span></a></li>`).join('') + '</ul></section>' : '',
    `<p class="help-back"><a href="${base}">All help topics</a></p>`,
    '</main>',
    footer(edition),
    '</body>',
    '</html>',
  ].filter(Boolean);
  return head({ title, description: article.description, canonical, edition, jsonLd }) + '\n' + body.join('\n') + '\n';
}

function renderIndex(edition) {
  const base = EDITIONS[edition].base;
  const canonical = `${ORIGIN}/help`;
  const description = 'Short, plain answers for Veylet Capture: getting started, capturing rooms, sending, fixing a capture, sharing your walkthrough, privacy and your account.';
  const jsonLd = edition === 'public' ? {
    '@context': 'https://schema.org',
    '@graph': [{ '@type': 'CollectionPage', '@id': canonical + '#collection', url: canonical, name: 'Veylet help centre', description, inLanguage: 'en-AU',
      isPartOf: { '@id': `${ORIGIN}/#website` }, publisher: { '@id': `${ORIGIN}/#organization` },
      mainEntity: { '@type': 'ItemList', numberOfItems: ARTICLES.length,
        itemListElement: ARTICLES.map((article, index) => ({ '@type': 'ListItem', position: index + 1, name: plain(article.title), url: `${ORIGIN}/help/${article.slug}` })) } }],
  } : null;
  const groups = GROUPS.map(group => {
    const items = ARTICLES.filter(article => article.group === group.id);
    return `<section class="help-group" aria-labelledby="${group.id}"><h2 id="${group.id}">${escape(group.title)}</h2><p>${escape(group.summary)}</p><ul class="guide-list">`
      + items.map(article => `<li><a href="${base}/${article.slug}"><span class="guide-list-title">${escape(plain(article.title))}</span><span class="guide-list-summary">${escape(article.description)}</span></a></li>`).join('')
      + '</ul></section>';
  }).join('\n');
  const body = [
    '<body class="help-page help-index">',
    '<a class="skip" href="#main">Skip to content</a>',
    header(edition),
    '<main id="main" class="wrap article-page">',
    '<header class="article-head"><h1>Help centre</h1><p class="article-answer">Short answers for each step, from your first capture to your client’s first visit. Pick a topic below.</p></header>',
    `<div class="help-groups">\n${groups}\n</div>`,
    '<section class="article-next help-stuck" aria-labelledby="still-stuck">',
    '<h2 id="still-stuck">Still stuck? Email Veylet support</h2>',
    `<p>Write to <a href="${escape(mailto('Veylet help'))}">${SUPPORT}</a> and a person replies. Say which step you were on, your iPhone or iPad model, and the app version from Account, then About. Never send passwords or sign-in links.</p>`,
    `<p class="article-actions"><a class="button" href="${escape(mailto('Veylet help'))}">Email Veylet support</a></p>`,
    '</section>',
    '</main>',
    footer(edition, edition === 'public'),
    '</body>',
    '</html>',
  ];
  return head({ title: edition === 'public' ? 'Help centre — Veylet' : 'Help — Veylet', description, canonical, edition, jsonLd }) + '\n' + body.join('\n') + '\n';
}

// fix/<flag>: one line and a redirect to the flag's section of the shared article.
function renderFlagRedirect(rule, edition) {
  const base = EDITIONS[edition].base;
  const target = `${base}/${FLAG_ARTICLE}#${rule}`;
  const section = ARTICLES.find(article => article.slug === FLAG_ARTICLE).body.find(item => item.id === rule);
  const lines = [
    '<!doctype html>', '<html lang="en">', '<head>', '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${escape(section.title)} — Veylet help</title>`,
    `<meta name="description" content="${escape('What the automatic check means by “' + section.title.toLowerCase() + '”, and what to do.')}">`,
    '<meta name="robots" content="noindex,follow">',
    `<meta http-equiv="refresh" content="0; url=${target}">`,
    '<meta name="theme-color" content="#10231d">', stylesheets(), '</head>',
    '<body class="help-page">',
    `<main id="main" class="wrap"><p class="help-redirect"><a href="${target}">${escape(section.title)}: open the explanation</a></p></main>`,
    '</body>', '</html>',
  ].filter(Boolean);
  return lines.join('\n') + '\n';
}

/** Every generated page: { file (relative to dist), html }. */
function pages() {
  const out = [];
  for (const edition of ['public', 'app']) {
    const dir = edition === 'public' ? 'help' : 'app/help';
    out.push({ file: `${dir}/index.html`, html: renderIndex(edition), edition, kind: 'index' });
    for (const article of ARTICLES) out.push({ file: `${dir}/${article.slug}/index.html`, html: renderArticle(article, edition), edition, kind: 'article', slug: article.slug });
    for (const rule of FLAG_RULES) out.push({ file: `${dir}/fix/${rule}/index.html`, html: renderFlagRedirect(rule, edition), edition, kind: 'redirect', slug: `fix/${rule}` });
  }
  return out;
}

function write() {
  for (const page of pages()) {
    const file = path.join(DIST, page.file);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, page.html);
  }
}

module.exports = { ARTICLES, GROUPS, EDITIONS, RECAPTURE_RULES, FLAG_RULES, FLAG_ARTICLE, SUPPORT, ORIGIN, pages, plain, assetHash };

if (require.main === module) {
  if (process.argv.includes('--write')) {
    write();
    console.log(`Wrote ${pages().length} help pages under dist/help and dist/app/help.`);
  } else {
    console.log('Usage: node tests/help-articles.cjs --write');
  }
}
