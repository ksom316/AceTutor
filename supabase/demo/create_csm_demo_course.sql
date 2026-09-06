-- ============================================================================
--  Basic ICT Fundamentals (demo / testing course)   ·   CREATE / RE-SEED
-- ============================================================================
--  Purpose: a small, isolated, disposable course for rehearsing the COMPLETE
--  AceTutor student experience before the final defense — enroll, study a
--  lesson, use the AI Tutor / Guide Me, use Quiz Me, take an official module
--  quiz, see Mastery, deliberately fail questions to trigger a Study Path,
--  view remedial content, retake the quiz, and check the student dashboard +
--  lecturer analytics.
--
--  This script:
--    * creates ONE course, SIX beginner modules, THREE text lessons per module,
--      5 official questions per module, and ONE General Course Quiz (10 Qs);
--    * uses FIXED UUIDs for every row, so re-running it UPDATES content in
--      place and never duplicates anything and never deletes tester-generated
--      data (quiz attempts, answers, progress, study paths stay intact);
--    * touches NO existing real course and changes NO schema / policy / logic;
--    * adds NO media URLs (requirement 10) — every lesson is text, because the
--      project has no bundled media asset that can be reused safely.
--
--  HOW TO RUN: paste into the Supabase SQL Editor and run once (top to bottom).
--  Safe to run again at any time. See delete_csm_demo_course.sql to remove it.
--
--  FIXED DEMO COURSE UUID:  de300000-0000-4000-a000-000000000000
--  (all demo rows share the de300000-0000-4000-a000-... prefix)
-- ============================================================================

begin;

-- ----------------------------------------------------------------------------
-- 1. Course
-- ----------------------------------------------------------------------------
insert into public.courses (id, slug, title, summary, cover_url, order_index)
values (
  'de300000-0000-4000-a000-000000000000',
  'csm-demo-testing-only',
  'Basic ICT Fundamentals',
  'An introduction to computers, hardware, software, operating systems, '
    || 'internet concepts, cybersecurity basics, and productivity tools. '
    || 'Demo / testing course for rehearsing the full AceTutor student '
    || 'walkthrough — safe to remove with supabase/demo/delete_csm_demo_course.sql.',
  null,
  9000
)
on conflict (id) do update set
  slug        = excluded.slug,
  title       = excluded.title,
  summary     = excluded.summary,
  cover_url   = excluded.cover_url,
  order_index = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 2. Modules (topics)
-- ----------------------------------------------------------------------------
insert into public.topics (id, course_id, slug, title, summary, order_index, quiz_duration_minutes)
values
  ('de300000-0000-4000-a000-000000000101',
   'de300000-0000-4000-a000-000000000000',
   'introduction-to-computers',
   'Module 1 — Introduction to Computers',
   'What a computer is, the main types of computer, and the components inside one.',
   0, 15),
  ('de300000-0000-4000-a000-000000000102',
   'de300000-0000-4000-a000-000000000000',
   'hardware-and-software',
   'Module 2 — Hardware and Software',
   'Input and output devices, storage, and the difference between system and application software.',
   1, 15),
  ('de300000-0000-4000-a000-000000000103',
   'de300000-0000-4000-a000-000000000000',
   'operating-systems-basics',
   'Module 3 — Operating Systems Basics',
   'What an operating system does, the common ones, and how to manage files and folders.',
   2, 15),
  ('de300000-0000-4000-a000-000000000104',
   'de300000-0000-4000-a000-000000000000',
   'internet-and-networking-basics',
   'Module 4 — Internet and Networking Basics',
   'How the internet works, using browsers and search engines, and basic networking terms.',
   3, 15),
  ('de300000-0000-4000-a000-000000000105',
   'de300000-0000-4000-a000-000000000000',
   'cybersecurity-fundamentals',
   'Module 5 — Cybersecurity Fundamentals',
   'Password safety, recognising malware and phishing, and safe habits online.',
   4, 15),
  ('de300000-0000-4000-a000-000000000106',
   'de300000-0000-4000-a000-000000000000',
   'productivity-applications',
   'Module 6 — Productivity Applications',
   'The basics of word processing, spreadsheets, and presentation software.',
   5, 15)
on conflict (id) do update set
  course_id             = excluded.course_id,
  slug                  = excluded.slug,
  title                 = excluded.title,
  summary               = excluded.summary,
  order_index           = excluded.order_index,
  quiz_duration_minutes = excluded.quiz_duration_minutes;

-- ----------------------------------------------------------------------------
-- 3. Lessons (all text — no media URLs, see header)
-- ----------------------------------------------------------------------------

-- Module 1 — Introduction to Computers
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000201',
   'de300000-0000-4000-a000-000000000101', 'text',
   'What is a Computer?',
   $md$## A simple definition

A **computer** is an electronic machine that takes in **data** (input), follows stored instructions to **process** it, produces a **result** (output), and can **store** information for later use.

## The four basic operations (the IPOS cycle)

1. **Input** — you give the computer data: typing, clicking, tapping, speaking, taking a photo.
2. **Processing** — the computer works on the data by following a program.
3. **Output** — the computer shows a result: text on screen, a printout, sound.
4. **Storage** — the computer keeps data so it can be used again later, such as a saved file.

## Everyday examples

- A **smartphone** is a small computer: touch input, apps that process, a screen for output, and internal storage for photos.
- An **ATM** reads your card and PIN (input), checks your balance (processing), and dispenses cash and a receipt (output).
- A **washing machine** contains a tiny computer that follows the wash programme you select.

## Why computers are useful

They are **fast**, **accurate**, **tireless**, and store huge amounts of information in a small space. A computer only ever does what its instructions tell it to do — it is not intelligent on its own. If the input data is wrong, the output will be wrong too.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000202',
   'de300000-0000-4000-a000-000000000101', 'text',
   'Types of Computers',
   $md$## Computers come in many sizes

- **Supercomputer** — room-sized; used for weather forecasting and scientific research.
- **Server** — a rack or cabinet; runs websites and stores shared files for an organisation.
- **Desktop PC** — sits on a desk; used for office work, study and gaming.
- **Laptop** — portable and folds shut; does the same work as a desktop, with a built-in battery, keyboard and screen.
- **Tablet** — a flat touchscreen device for reading, browsing and light tasks.
- **Smartphone** — fits in your hand; calls, messaging, apps and camera.
- **Embedded computer** — hidden inside another device to control it, such as in a car, a microwave or a router.

## Desktop compared with laptop

- A **desktop** costs less for the same power and is easy to upgrade, but you cannot move it.
- A **laptop** trades some power and upgrade options for **portability**.

## Servers and the cloud

When you use online email, a streaming service or AceTutor, your device talks to powerful **servers** in a data centre. **The cloud** simply means servers owned by a provider that you reach over the internet.

## Example

A university might use servers for its student portal, desktops in the library, laptops for staff, and embedded computers in the door-access system — all at the same time.
$md$,
   null, null, 1),

  ('de300000-0000-4000-a000-000000000203',
   'de300000-0000-4000-a000-000000000101', 'text',
   'Basic Computer Components',
   $md$## The parts that do the work

- **CPU (Central Processing Unit)** — the brain of the computer; carries out instructions and calculations. Speed is measured in gigahertz (GHz).
- **RAM (Random Access Memory)** — fast, short-term working memory for open programs and files. RAM is **volatile**: its contents are lost when the power goes off. Measured in gigabytes (GB).
- **Storage (SSD or HDD)** — long-term memory that keeps your files, apps and operating system even when the machine is switched off.
- **Motherboard** — the main circuit board that connects everything together.
- **Power supply (PSU)** — converts mains electricity into the low voltages the parts need.
- **GPU (Graphics Processing Unit)** — draws images on the screen; important for games, video and design.

## RAM compared with storage — a common mix-up

Think of a desk:

- **RAM** is the desk surface: how much you can spread out and work on right now. Clear the desk (power off) and that work is gone.
- **Storage** is the drawers and filing cabinet: where things are kept when you finish.

More **RAM** means more programs run smoothly at once. More **storage** means more files and apps you can keep.

## Example

A computer with a fast CPU but only 4 GB of RAM will feel slow with many browser tabs open, because it runs out of working memory and has to keep shuffling data to the slower storage.
$md$,
   null, null, 2)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 2 — Hardware and Software
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000204',
   'de300000-0000-4000-a000-000000000102', 'text',
   'Input and Output Devices',
   $md$## Hardware you can touch

**Hardware** is any physical part of a computer system. Devices that carry information **into** the computer are **input devices**; devices that carry results **out** are **output devices**.

## Common input devices

- **Keyboard** — types text and commands.
- **Mouse or trackpad** — moves the pointer, clicks and drags.
- **Microphone** — captures sound and voice.
- **Webcam or camera** — captures images and video.
- **Scanner** — turns a paper document into a digital image.

## Common output devices

- **Monitor or screen** — shows text, images and video.
- **Printer** — produces a paper copy, called a hard copy.
- **Speakers or headphones** — play sound.
- **Projector** — shows the screen image on a large surface.

## Devices that do both

Some hardware is input **and** output:

- A **touchscreen** displays content and accepts touches.
- A **headset** has a microphone (in) and earphones (out).

## Example

Printing a photo you just took: the **camera** is the input device, the **printer** is the output device, and the **screen** you used to crop it is an output device while the **mouse** was input.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000205',
   'de300000-0000-4000-a000-000000000102', 'text',
   'Storage Devices',
   $md$## Why storage matters

**Storage** keeps your data when the power is off. This is different from **RAM**, which forgets everything when the computer shuts down.

## Types of storage

- **SSD (Solid State Drive)** — very fast, no moving parts, now standard in laptops.
- **HDD (Hard Disk Drive)** — a spinning magnetic disk; slower, but cheap for large capacities.
- **USB flash drive** — small and portable, easy to carry and easy to lose.
- **Memory card (SD)** — used in cameras and phones.
- **Cloud storage** — files kept on a provider's servers and reached over the internet.

## Measuring capacity

- 1 **kilobyte (KB)** is roughly a short email.
- 1 **megabyte (MB)** is roughly a photo or a song.
- 1 **gigabyte (GB)** is about 1,000 MB — around 250 songs.
- 1 **terabyte (TB)** is about 1,000 GB — a large laptop drive.

## Backups

Keep important files in **more than one place**, for example on your laptop **and** in cloud storage. A simple rule is 3-2-1: three copies, on two types of media, with one copy kept somewhere else.
$md$,
   null, null, 1),

  ('de300000-0000-4000-a000-000000000206',
   'de300000-0000-4000-a000-000000000102', 'text',
   'System Software and Application Software',
   $md$## Software is instructions

**Software** is the set of instructions that tells the hardware what to do. There are two broad kinds.

## System software

Runs the computer itself and supports other programs:

- **Operating system (OS)** — Windows, macOS, Linux, Android, iOS. Manages hardware, memory, files and running programs.
- **Device drivers** — small programs that let the OS control a specific printer, graphics card and so on.
- **Utilities** — antivirus, disk clean-up, file compression.

## Application software (apps)

Helps **you** do a task:

- **Word processor** (Microsoft Word, Google Docs) — write documents.
- **Spreadsheet** (Excel, Google Sheets) — work with numbers and tables.
- **Web browser** (Chrome, Firefox, Edge) — view websites.
- Media players, photo editors, games and email clients.

## How they relate

You use an **application**; the application asks the **operating system** for services such as opening a file or printing; the OS controls the **hardware**.

You, then application software, then the operating system, then hardware.

## Example

When you save a document in Word, the app hands the data to the OS, which writes it to the storage drive through a driver.
$md$,
   null, null, 2)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 3 — Operating Systems Basics
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000207',
   'de300000-0000-4000-a000-000000000103', 'text',
   'What is an Operating System?',
   $md$## The software that runs the computer

An **operating system (OS)** is the master program that starts when you switch the computer on and keeps running until you shut down. Every app runs on top of the OS.

## What the OS does

- **Manages hardware** — CPU time, RAM, storage, printers, the network.
- **Manages files** — creating, naming, saving, moving and deleting.
- **Runs programs** — starts and stops apps and shares resources between them.
- **Provides the user interface** — the desktop, windows, icons, menus and touch gestures.
- **Handles security** — user accounts, passwords and permissions.

## Types of user interface

- **GUI (Graphical User Interface)** — you point and click icons and windows (Windows, macOS, Android).
- **CLI (Command Line Interface)** — you type text commands. Powerful, but harder for beginners.

## Booting

**Booting** is the start-up process: the computer loads the operating system from storage into RAM so it is ready to use.

## Example

When you double-click a music file, the OS locates the file, opens the correct app, gives it RAM and CPU time, and routes the sound to the speakers — all automatically.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000208',
   'de300000-0000-4000-a000-000000000103', 'text',
   'Common Operating Systems',
   $md$## The main systems you will meet

- **Windows** (Microsoft) — the most common desktop OS; runs on PCs from many brands.
- **macOS** (Apple) — runs only on Apple Mac computers; popular for creative work.
- **Linux** — free and open-source; comes in many versions, called distributions, and powers most web servers.
- **Android** (Google) — the most used mobile OS in the world; on phones and tablets from many brands.
- **iOS and iPadOS** (Apple) — run only on iPhone and iPad.
- **Chrome OS** (Google) — a lightweight system for Chromebooks, built around the web browser.

## Why the OS matters when choosing software

Most programs are written for **one OS**. A Windows installer file, ending in .exe, will not run on macOS or Android without special tools. **Web apps**, such as AceTutor, avoid this because they run inside a browser on any OS.

## Proprietary compared with open-source

- **Proprietary** (Windows, macOS) — owned by a company; you buy or license it.
- **Open-source** (Linux) — the code is public and free to use and change.

## Example

A computer lab might run Windows for compatibility with exam software, while the school website is hosted on a Linux server.
$md$,
   null, null, 1),

  ('de300000-0000-4000-a000-000000000209',
   'de300000-0000-4000-a000-000000000103', 'text',
   'Managing Files and Folders',
   $md$## Files and folders

- A **file** is a single saved item: a document, photo, song or video.
- A **folder**, also called a directory, is a container that holds files and other folders.
- A **path** shows where a file lives, for example Documents/ICT/Assignment1.docx.

## File names and extensions

A file name usually ends with an **extension** that tells you and the computer what type it is:

- **.docx** — Word document
- **.xlsx** — Excel spreadsheet
- **.pptx** — PowerPoint presentation
- **.pdf** — fixed-layout document
- **.jpg** or **.png** — image
- **.mp3** or **.mp4** — audio or video
- **.txt** — plain text

## Everyday file tasks

- **Save** with Ctrl+S on Windows or Cmd+S on a Mac.
- **Copy** leaves the original in place; **move** (cut) does not.
- **Rename** files with clear, meaningful names such as Budget-2026.xlsx.
- **Delete** sends a file to the Recycle Bin or Trash first, so it can be restored until the bin is emptied.
- **Search** using the file manager search box when you cannot remember where something is.

## Good habits

Keep a simple folder structure, such as one folder per course, name files with dates, and back up regularly.

## Example

The path Documents/ICT-Fundamentals/Module3/Notes.docx tells you the subject, the module and the file type at a glance.
$md$,
   null, null, 2)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 4 — Internet and Networking Basics
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000210',
   'de300000-0000-4000-a000-000000000104', 'text',
   'Understanding the Internet',
   $md$## Internet compared with Web

- The **internet** is a global **network of networks** — millions of computers linked by cable, fibre and wireless.
- The **World Wide Web** is just **one service** that runs on the internet: pages and links you open in a browser.
- Other internet services include **email**, **video calls**, **online games** and **file transfer**.

So the Web needs the internet, but the internet is much more than the Web.

## How a page reaches you

1. You type a web address (a **URL**) into a browser.
2. **DNS**, the Domain Name System, looks up the site numeric **IP address**, like a phone book.
3. Your request travels through your **router**, your **Internet Service Provider (ISP)** and across the internet to the **web server**.
4. The server sends the page back and the browser displays it.

## Key terms

- **IP address** — a unique number identifying a device on a network.
- **URL** — the full address of a web page.
- **HTTP and HTTPS** — the rules for transferring web pages. HTTPS is encrypted; look for the padlock.
- **Bandwidth** — how much data a connection can carry per second, measured in Mbps.

## Example

Streaming a lecture recording uses a lot of bandwidth; sending a text message uses almost none.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000211',
   'de300000-0000-4000-a000-000000000104', 'text',
   'Web Browsers and Search Engines',
   $md$## Web browsers

A **web browser** is the app you use to view websites. Common browsers are **Chrome, Firefox, Edge and Safari**.

Useful browser features:

- **Tabs** — several pages open in one window.
- **Bookmarks**, also called favourites — save a page so you can return to it.
- **History** — a list of pages you have visited.
- **Address bar** — type a URL or a search term.
- **Private or incognito mode** — does not save history on the device, but does **not** make you anonymous online.

## Search engines

A **search engine** such as Google, Bing or DuckDuckGo is a website that indexes the Web and helps you find pages by keyword. The browser is the tool; the search engine is a website you open with it.

## Searching well

- Use **specific keywords**: APA 7th edition referencing beats how do I do references.
- Put a phrase in quotation marks to match it exactly.
- Check the **source** — prefer official, educational and recent pages.
- Remember that the first results are often adverts.

## Example

To understand an error message, search the exact message wording. You are more likely to find other people who had the same problem.
$md$,
   null, null, 1),

  ('de300000-0000-4000-a000-000000000212',
   'de300000-0000-4000-a000-000000000104', 'text',
   'Basic Networking Concepts',
   $md$## What a network is

A **network** is two or more devices connected so they can share data and resources such as files, a printer or an internet connection.

## Network sizes

- **LAN (Local Area Network)** — covers one home or building, such as your Wi-Fi and the devices on it.
- **WAN (Wide Area Network)** — spans cities or countries. The internet is the largest WAN.

## Common network hardware

- **Router** — connects your local network to the internet and directs traffic between them.
- **Modem** — converts the signal from your ISP into data your router can use. Often built into the same box as the router.
- **Switch** — connects several wired devices within a LAN.
- **Access point** — provides the Wi-Fi signal.

## Wired compared with wireless

- **Ethernet cable** — faster, more stable and more secure, but you are tied to one spot.
- **Wi-Fi** — convenient and cable-free, but slower over distance and through walls, and it needs a password to stay private.

## Client and server

- A **client** requests a service, such as your laptop opening a web page.
- A **server** provides it, such as the computer that stores and sends that web page.

## Example

At home your laptop (client) connects by Wi-Fi to a router, which reaches your ISP and then a web server (server) that returns the page.
$md$,
   null, null, 2)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 5 — Cybersecurity Fundamentals
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000213',
   'de300000-0000-4000-a000-000000000105', 'text',
   'Password Safety',
   $md$## Why passwords matter

A password is often the only thing protecting your email, bank and study accounts. If someone gets into your email, they can reset the passwords for many other services.

## What makes a strong password

- **Long** — aim for at least 12 to 16 characters. Length matters more than symbols.
- **Unpredictable** — no names, birthdays, the word password, or 123456.
- **Unique** — a different password for every important account.

A good method is a **passphrase**: four or more random words joined together, such as orange-tractor-velvet-canyon. Easy to remember, hard to guess.

## Password managers

A **password manager** generates and stores long, unique passwords, so you only have to remember one master password.

## Two-factor authentication (2FA)

**2FA** adds a second step after your password, such as a code from an app or your fingerprint. Even if your password leaks, an attacker still cannot log in. Turn 2FA on for email, banking and social media.

## What not to do

- Do not reuse one password across many sites.
- Do not share passwords by email or chat.
- Do not keep them in a plain file named passwords.txt.

## Example

If a shopping site is breached and your password there leaks, unique passwords mean only that one account is at risk — not your email and bank as well.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000214',
   'de300000-0000-4000-a000-000000000105', 'text',
   'Malware and Phishing',
   $md$## Malware

**Malware** means malicious software: any program written to harm or exploit a device.

- **Virus** — attaches to a file and spreads when that file is shared.
- **Worm** — spreads by itself across a network.
- **Trojan** — pretends to be useful software but hides a harmful payload.
- **Ransomware** — locks or encrypts your files and demands payment.
- **Spyware** — secretly records what you type or do.

## How malware gets in

- Opening an infected email attachment.
- Downloading pirated or fake software.
- Clicking a malicious link or advert.
- Plugging in an unknown USB drive.

## Phishing

**Phishing** is a trick, not a program: a fake message that pretends to be from a bank, university or delivery company and tries to make you hand over a password or click a bad link.

Warning signs:

- An urgent or threatening tone.
- A link address that does not match the real organisation.
- Poor spelling and grammar.
- A request for a password, PIN or code — real organisations never ask for these.

## Defence

Keep software **updated**, run **antivirus**, do not open unexpected attachments, and check the sender real address. When in doubt, go to the website directly instead of clicking the link.
$md$,
   null, null, 1),

  ('de300000-0000-4000-a000-000000000215',
   'de300000-0000-4000-a000-000000000105', 'text',
   'Safe Internet Practices',
   $md$## Everyday safe habits

- **Update** your operating system, browser and apps — updates close security holes.
- **Lock** your device with a PIN, password or fingerprint, and set it to lock automatically.
- **Think before you click** links and download files, especially from unknown senders.
- **Look for HTTPS** and the padlock before entering personal details.
- **Be careful on public Wi-Fi** — avoid banking, and use a VPN if you can.

## Protecting your privacy

- Review the **privacy settings** on social media and limit who can see your posts.
- Share less. Your full birthday, address and location can be used against you.
- Anything posted online can be copied and kept even after you delete it. This is your **digital footprint**.

## Backups defend against attacks

Regular backups mean ransomware cannot hold your only copy hostage. Keep at least one backup disconnected or in the cloud.

## Recognising a scam

Be sceptical of you have won a prize, verify your account now, requests to pay with gift cards, and pressure to act immediately. Legitimate organisations give you time and never ask for your password.

## Example

Before you type your student login into a page, check that the address bar really shows your university domain and a padlock. A phishing page often uses a look-alike address.
$md$,
   null, null, 2)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- Module 6 — Productivity Applications
insert into public.lessons (id, topic_id, modality, title, body_md, media_url, duration_sec, order_index)
values
  ('de300000-0000-4000-a000-000000000216',
   'de300000-0000-4000-a000-000000000106', 'text',
   'Word Processing Basics',
   $md$## What a word processor is for

A **word processor** such as Microsoft Word, Google Docs or LibreOffice Writer creates **text documents**: essays, reports, letters and CVs.

## Core skills

- **Text formatting** — font, size, bold, italic, underline, colour.
- **Paragraph formatting** — alignment, line spacing and indents.
- **Styles** — apply Heading 1, Heading 2 and Normal so the document is consistent and can generate a **table of contents** automatically.
- **Lists** — bulleted and numbered.
- **Spell check and grammar check** — helpful, but still proofread yourself.
- **Insert** — images, tables, page numbers and links.

## Saving and sharing

- Save often with Ctrl+S.
- Export to **PDF** when you want the layout fixed, for example when submitting an assignment.
- Use **track changes** when other people review your work.

## Useful shortcuts

- Ctrl+C, Ctrl+V, Ctrl+X — copy, paste, cut.
- Ctrl+Z, Ctrl+Y — undo, redo.
- Ctrl+B, Ctrl+I, Ctrl+U — bold, italic, underline.

## Example

Using Heading styles instead of just enlarging text lets the program build and update a table of contents for a long report in one click.
$md$,
   null, null, 0),

  ('de300000-0000-4000-a000-000000000217',
   'de300000-0000-4000-a000-000000000106', 'text',
   'Spreadsheet Basics',
   $md$## What a spreadsheet is for

A **spreadsheet** such as Microsoft Excel or Google Sheets organises **data in rows and columns** and performs **calculations** automatically. It is good for budgets, marks, schedules and simple charts.

## The grid

- **Columns** are labelled with letters (A, B, C), **rows** with numbers (1, 2, 3).
- A **cell** is one box, named by its column and row, such as B4.
- A **range** is a block of cells, such as B2:B10.

## Formulas and functions

- Every formula starts with an equals sign.
- =B2+B3 adds two cells together.
- Built-in **functions** are shortcuts:
  - =SUM(B2:B10) totals a range.
  - =AVERAGE(B2:B10) finds the mean.
  - =MAX(B2:B10) and =MIN(B2:B10) find the largest and smallest.
  - =COUNT(B2:B10) counts how many numbers there are.

## Filling formulas

Drag the small square at a cell corner to copy a formula down a column; the references adjust automatically, so B2 becomes B3, then B4.

## Sorting, filtering and charts

- **Sort** rows by a column, such as highest mark first.
- **Filter** to show only rows that match a condition.
- **Charts** turn a range of numbers into a bar, line or pie graph.

## Example

To average a class set of marks in cells C2 to C31, type =AVERAGE(C2:C31). The result updates by itself whenever a mark changes.
$md$,
   null, null, 1),

  ('de300000-0000-4000-a000-000000000218',
   'de300000-0000-4000-a000-000000000106', 'text',
   'Presentation Software Basics',
   $md$## What presentation software is for

**Presentation software** such as Microsoft PowerPoint, Google Slides or LibreOffice Impress builds a **slide show** to support a talk.

## Building a deck

- Each **slide** is one screen. Keep to one main idea per slide.
- Use a short **title** and a few **bullet points**, not full paragraphs.
- Add **images, charts or diagrams** to explain ideas visually.
- Put what you plan to say in the **speaker notes**; the audience does not see them.

## Design tips

- Keep to about six bullet points per slide and six words per bullet.
- Use a large, readable font of at least 24 points.
- Use high contrast, such as dark text on a light background.
- Keep colours and fonts consistent by using a built-in theme.
- Avoid heavy animation and busy backgrounds.

## Delivering

- **Presenter view** shows your notes and the next slide on your screen while the audience sees only the current slide.
- Export to **PDF** to share a read-only copy.

## Example

Instead of a slide full of sales figures, show a bar chart of the figures and explain it out loud. The audience remembers the picture.
$md$,
   null, null, 2)
on conflict (id) do update set
  topic_id     = excluded.topic_id,
  modality     = excluded.modality,
  title        = excluded.title,
  body_md      = excluded.body_md,
  media_url    = excluded.media_url,
  duration_sec = excluded.duration_sec,
  order_index  = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 4. Official module-quiz questions (5 per module)
--    Fixed UUIDs + upsert so re-running only refreshes wording and never
--    cascade-deletes a tester's attempt_answers.
-- ----------------------------------------------------------------------------

-- Module 1 — Introduction to Computers
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000301',
   'de300000-0000-4000-a000-000000000101', null,
   'Which sequence best describes how a computer handles data?',
   '["Input, then processing, then output, then storage","Output, then storage, then input, then processing","Processing, then input, then storage, then output","Storage, then output, then processing, then input"]'::jsonb,
   0,
   'Computers follow the input-process-output-storage cycle: data goes in, is processed by instructions, a result comes out, and information can be stored for later.',
   1, 0),
  ('de300000-0000-4000-a000-000000000302',
   'de300000-0000-4000-a000-000000000101', null,
   'Which statement about a computer is correct?',
   '["A computer can think and make its own decisions","A computer works even with no instructions at all","A computer only does what its instructions tell it to do","A computer automatically corrects wrong input data"]'::jsonb,
   2,
   'A computer follows its program exactly. If the data or the instructions are wrong, the output will be wrong too.',
   2, 1),
  ('de300000-0000-4000-a000-000000000303',
   'de300000-0000-4000-a000-000000000101', null,
   'Which of these is an example of an embedded computer?',
   '["A desktop PC used in an office","The control unit built into a microwave oven","A cloud server that hosts a website","A laptop used for studying"]'::jsonb,
   1,
   'An embedded computer is a small computer built into another device to control it, such as the one inside a microwave, a car or a router.',
   2, 2),
  ('de300000-0000-4000-a000-000000000304',
   'de300000-0000-4000-a000-000000000101', null,
   'In computing, what does the term cloud mean?',
   '["Wireless storage that floats around your home","A type of weather-forecasting program","Files stored only on your own hard drive","Servers owned by a provider that you reach over the internet"]'::jsonb,
   3,
   'The cloud simply means remote servers in a data centre that you access over the internet, as with online email or streaming services.',
   2, 3),
  ('de300000-0000-4000-a000-000000000305',
   'de300000-0000-4000-a000-000000000101', null,
   'Compared with a desktop, what is the main advantage of a laptop?',
   '["It is portable and has a built-in battery, keyboard and screen","It is always more powerful than a desktop","It can never be upgraded or repaired","It does not need an operating system"]'::jsonb,
   0,
   'A laptop trades some power and upgrade options for portability and built-in components.',
   1, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 2 — Hardware and Software
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000311',
   'de300000-0000-4000-a000-000000000102', null,
   'Which device is an input device only?',
   '["A touchscreen","A scanner","A monitor","A pair of speakers"]'::jsonb,
   1,
   'A scanner only sends data into the computer, so it is an input device. A touchscreen does both input and output; a monitor and speakers are output.',
   1, 0),
  ('de300000-0000-4000-a000-000000000312',
   'de300000-0000-4000-a000-000000000102', null,
   'What is the key difference between RAM and storage such as an SSD or HDD?',
   '["RAM is always larger than storage","RAM is only used when printing","Storage is wiped every time you shut down","RAM loses its contents when the power is switched off, but storage keeps them"]'::jsonb,
   3,
   'RAM is volatile working memory. Storage such as an SSD or HDD is non-volatile and keeps files when the computer is switched off.',
   2, 1),
  ('de300000-0000-4000-a000-000000000313',
   'de300000-0000-4000-a000-000000000102', null,
   'Which item is system software?',
   '["An operating system","A spreadsheet program","A web browser","A photo editor"]'::jsonb,
   0,
   'The operating system is system software. Spreadsheets, browsers and photo editors are application software.',
   1, 2),
  ('de300000-0000-4000-a000-000000000314',
   'de300000-0000-4000-a000-000000000102', null,
   'Roughly how much data is one gigabyte (GB)?',
   '["About one short email","About 1,000 terabytes","About 1,000 megabytes","About one single photo"]'::jsonb,
   2,
   'One gigabyte is roughly 1,000 megabytes. A short email is a few kilobytes and a photo is a few megabytes.',
   2, 3),
  ('de300000-0000-4000-a000-000000000315',
   'de300000-0000-4000-a000-000000000102', null,
   'A student wants to protect an important assignment from loss. Best practice is to:',
   '["Keep the only copy on one USB flash drive","Keep copies in two places, such as the laptop and cloud storage","Print it and delete the digital file","Rename the file several times"]'::jsonb,
   1,
   'Keep at least two copies on different media, for example a laptop plus cloud storage. A single USB drive is easy to lose or damage.',
   1, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 3 — Operating Systems Basics
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000321',
   'de300000-0000-4000-a000-000000000103', null,
   'Which task is NOT a job of the operating system?',
   '["Sharing CPU time and memory between programs","Organising files and folders","Writing the content of your essay","Showing the desktop, windows and menus"]'::jsonb,
   2,
   'The operating system manages hardware, files, programs, the interface and security. Producing content is done by the user with application software.',
   1, 0),
  ('de300000-0000-4000-a000-000000000322',
   'de300000-0000-4000-a000-000000000103', null,
   'What is booting?',
   '["The start-up process that loads the operating system into memory","Deleting temporary files to free space","Connecting the computer to Wi-Fi","Closing a program that has frozen"]'::jsonb,
   0,
   'Booting is the start-up sequence that loads the operating system from storage into RAM so the computer is ready to use.',
   2, 1),
  ('de300000-0000-4000-a000-000000000323',
   'de300000-0000-4000-a000-000000000103', null,
   'Which operating system runs ONLY on hardware made by one company?',
   '["Linux","Windows","Android","macOS"]'::jsonb,
   3,
   'macOS runs only on Apple Mac computers. Windows, Linux and Android run on hardware from many different manufacturers.',
   2, 2),
  ('de300000-0000-4000-a000-000000000324',
   'de300000-0000-4000-a000-000000000103', null,
   'A file is named report.pdf. What does the .pdf part tell you?',
   '["The size of the file","The type of file and which program opens it","The date the file was created","The person who created the file"]'::jsonb,
   1,
   'The part of a file name after the dot is the extension, which shows the file type and which program opens it.',
   1, 3),
  ('de300000-0000-4000-a000-000000000325',
   'de300000-0000-4000-a000-000000000103', null,
   'You delete a file by mistake on a Windows PC. What usually happens first?',
   '["It is destroyed immediately and cannot be recovered","It is emailed to your account as a backup","It is moved to the Recycle Bin and can be restored","It is uploaded to the cloud automatically"]'::jsonb,
   2,
   'Deleted files go to the Recycle Bin, or Trash on a Mac, and can be restored until that bin is emptied.',
   1, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 4 — Internet and Networking Basics
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000331',
   'de300000-0000-4000-a000-000000000104', null,
   'What is the relationship between the internet and the World Wide Web?',
   '["The internet and the Web are exactly the same thing","The internet is one service that runs on the Web","The Web is the cables and the internet is the pages","The Web is one of several services that run on the internet"]'::jsonb,
   3,
   'The internet is the global network. The Web, meaning pages viewed in a browser, is one service that uses it, alongside email, video calls and file transfer.',
   2, 0),
  ('de300000-0000-4000-a000-000000000332',
   'de300000-0000-4000-a000-000000000104', null,
   'What does DNS do when you visit a website?',
   '["It encrypts your password before you send it","It translates a website name into its numeric IP address","It stores a history of every site you visit","It blocks adverts on web pages"]'::jsonb,
   1,
   'The Domain Name System works like a phone book, turning a name such as example.com into the IP address that computers use to route the request.',
   2, 1),
  ('de300000-0000-4000-a000-000000000333',
   'de300000-0000-4000-a000-000000000104', null,
   'You see a padlock and https at the start of the address. This means:',
   '["The website is owned by a government","The web page contains no mistakes","The connection between you and the website is encrypted","The website is free to use"]'::jsonb,
   2,
   'HTTPS with a padlock means data sent between you and the site is encrypted. It does not prove the site is honest or accurate.',
   2, 2),
  ('de300000-0000-4000-a000-000000000334',
   'de300000-0000-4000-a000-000000000104', null,
   'Which device connects your home network to the internet and directs traffic between them?',
   '["Router","Monitor","Printer","Webcam"]'::jsonb,
   0,
   'A router links your local network to the wider internet and forwards data between them. A modem converts the ISP signal, and the two are often in one box.',
   1, 3),
  ('de300000-0000-4000-a000-000000000335',
   'de300000-0000-4000-a000-000000000104', null,
   'Which is the best way to search for the cause of a specific error message?',
   '["Search for why is my computer broken","Search for help computer not working","Search for questions about computer errors","Search the exact error text, placed inside quotation marks"]'::jsonb,
   3,
   'Searching the exact wording in quotation marks matches that phrase precisely and finds other people who had the same error.',
   1, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 5 — Cybersecurity Fundamentals
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000341',
   'de300000-0000-4000-a000-000000000105', null,
   'Which of these is the strongest password?',
   '["orange-tractor-velvet-canyon","Pass1","John2005","qwerty"]'::jsonb,
   0,
   'A long passphrase made of several random words is hard to guess but easy to remember. Short passwords, names and keyboard patterns are weak.',
   1, 0),
  ('de300000-0000-4000-a000-000000000342',
   'de300000-0000-4000-a000-000000000105', null,
   'What is the main benefit of two-factor authentication (2FA)?',
   '["It lets you use a shorter password","It removes the need for a password","It makes logging in faster","Even if your password is stolen, the attacker still cannot log in"]'::jsonb,
   3,
   'Two-factor authentication adds a second step such as a code or a fingerprint, so a stolen password alone is not enough to get in.',
   2, 1),
  ('de300000-0000-4000-a000-000000000343',
   'de300000-0000-4000-a000-000000000105', null,
   'Which statement best describes phishing?',
   '["A program that spreads across a network by itself","A fake message that tricks you into giving away a password or clicking a bad link","Software that fills your screen with adverts","A tool that makes your passwords stronger"]'::jsonb,
   1,
   'Phishing is a deceptive message, not a program. It is designed to make you reveal information or click a malicious link.',
   1, 2),
  ('de300000-0000-4000-a000-000000000344',
   'de300000-0000-4000-a000-000000000105', null,
   'You get an urgent email saying your account will be closed today unless you click a link and confirm your password. What should you do?',
   '["Reply to the email with your password","Click the link and log in quickly","Do not click the link; open the official website directly and check your account","Forward the email to your friends"]'::jsonb,
   2,
   'Urgency and a request for your password are classic phishing signs. Go to the real website directly rather than using the link.',
   1, 3),
  ('de300000-0000-4000-a000-000000000345',
   'de300000-0000-4000-a000-000000000105', null,
   'How do regular backups help against ransomware?',
   '["You can wipe the device and restore your files instead of paying","Backups stop the malware from installing","Backups make your internet connection faster","Backups hide your IP address from attackers"]'::jsonb,
   0,
   'If a separate, disconnected or cloud backup exists, you can wipe the device and restore your data without paying the ransom.',
   2, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- Module 6 — Productivity Applications
insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000351',
   'de300000-0000-4000-a000-000000000106', null,
   'Which task is a spreadsheet best suited to?',
   '["Writing a three-page essay","Designing a slide show for a talk","Adding up a column of numbers and averaging a set of marks","Editing and cropping a photograph"]'::jsonb,
   2,
   'A spreadsheet organises data in rows and columns and calculates automatically with functions such as SUM and AVERAGE.',
   1, 0),
  ('de300000-0000-4000-a000-000000000352',
   'de300000-0000-4000-a000-000000000106', null,
   'In a spreadsheet, what must every formula begin with?',
   '["A capital letter","An equals sign","A dollar sign","A full stop"]'::jsonb,
   1,
   'Every spreadsheet formula begins with an equals sign, for example =SUM(B2:B10). A dollar sign is only used to lock a cell reference.',
   1, 1),
  ('de300000-0000-4000-a000-000000000353',
   'de300000-0000-4000-a000-000000000106', null,
   'Why use Heading styles in a word processor instead of just making text bigger and bold?',
   '["It makes the file take up less space","It changes the file type to PDF","It is required by university rules","It keeps formatting consistent and lets the program build a table of contents automatically"]'::jsonb,
   3,
   'Heading styles give a document a consistent structure and allow an automatically generated, updatable table of contents.',
   2, 2),
  ('de300000-0000-4000-a000-000000000354',
   'de300000-0000-4000-a000-000000000106', null,
   'Which is good practice when designing presentation slides?',
   '["Put one main idea on each slide, with short bullet points","Put full paragraphs of text on every slide","Add as many animations as possible","Use a very small font so more text fits"]'::jsonb,
   0,
   'Slides should support the speaker: one idea per slide, short bullets, a large readable font and little animation.',
   1, 3),
  ('de300000-0000-4000-a000-000000000355',
   'de300000-0000-4000-a000-000000000106', null,
   'You want to submit an assignment so its layout does not change on the marker computer. You should:',
   '["Send the original editable file and hope it looks the same","Export the document to PDF before submitting it","Take a photo of the screen and send that","Paste the text into the body of an email"]'::jsonb,
   1,
   'Exporting to PDF fixes the layout and fonts so the document looks identical on any computer.',
   2, 4)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 5. General Course Quiz  (+ 10 questions spanning all six modules)
--    available_from is a fixed past instant so it is always takeable;
--    no deadline, unlimited attempts (testers need to retake).
-- ----------------------------------------------------------------------------
insert into public.course_quizzes
  (id, course_id, title, description, available_from, deadline, max_attempts, duration_minutes)
values (
  'de300000-0000-4000-a000-0000000000c1',
  'de300000-0000-4000-a000-000000000000',
  'Basic ICT Fundamentals — General Course Quiz',
  'Covers all six modules of Basic ICT Fundamentals. Unlimited attempts, no deadline. Demo / testing content only.',
  timestamptz '2026-01-01 00:00:00+00',
  null,
  null,
  15
)
on conflict (id) do update set
  course_id        = excluded.course_id,
  title            = excluded.title,
  description      = excluded.description,
  available_from   = excluded.available_from,
  deadline         = excluded.deadline,
  max_attempts     = excluded.max_attempts,
  duration_minutes = excluded.duration_minutes;

insert into public.questions (id, topic_id, course_quiz_id, prompt, choices, correct_index, explanation, difficulty, order_index)
values
  ('de300000-0000-4000-a000-000000000401', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Which sequence describes how a computer processes data?',
   '["Input, processing, output, storage","Storage, output, processing, input","Output, input, storage, processing","Processing, storage, input, output"]'::jsonb,
   0, 'Computers follow the input-process-output-storage cycle.', 1, 0),
  ('de300000-0000-4000-a000-000000000402', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Which of these is application software?',
   '["Microsoft Windows","A printer device driver","Microsoft Excel","The operating system kernel"]'::jsonb,
   2, 'Excel is application software that helps a user complete a task. Windows, drivers and the kernel are system software.', 1, 1),
  ('de300000-0000-4000-a000-000000000403', null,
   'de300000-0000-4000-a000-0000000000c1',
   'RAM is called volatile memory. What does that mean?',
   '["It is the largest storage space in the computer","It loses its contents when the power is switched off","It can only store text, not images","It cannot be added to or upgraded"]'::jsonb,
   1, 'Volatile memory needs power to keep data. When the computer switches off, RAM is cleared; storage drives are not.', 2, 2),
  ('de300000-0000-4000-a000-000000000404', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Which component is often called the brain of the computer?',
   '["The monitor","The hard drive","The power supply","The CPU"]'::jsonb,
   3, 'The CPU, or Central Processing Unit, carries out the instructions and calculations for the whole computer.', 1, 3),
  ('de300000-0000-4000-a000-000000000405', null,
   'de300000-0000-4000-a000-0000000000c1',
   'What does a web browser do?',
   '["It requests web pages and displays them","It generates the electricity for the router","It stores every web page in the world on your computer","It replaces the operating system"]'::jsonb,
   0, 'A browser such as Chrome or Firefox fetches web pages and shows them. A search engine is a website you visit using the browser.', 1, 4),
  ('de300000-0000-4000-a000-000000000406', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Which sign in the address bar shows the connection to a site is encrypted?',
   '["A star or bookmark icon","The text http with no s","A padlock with https","A flashing question mark"]'::jsonb,
   2, 'HTTPS with a padlock means the connection between you and the website is encrypted.', 2, 5),
  ('de300000-0000-4000-a000-000000000407', null,
   'de300000-0000-4000-a000-0000000000c1',
   'What is the safest way to handle passwords?',
   '["Use one strong password for every account","Keep all passwords in a file named passwords.txt","Use very short passwords so they are easy to recall","Use a different long passphrase for each account and turn on two-factor authentication"]'::jsonb,
   3, 'Unique long passphrases limit the damage of any single breach, and two-factor authentication adds a second barrier.', 2, 6),
  ('de300000-0000-4000-a000-000000000408', null,
   'de300000-0000-4000-a000-0000000000c1',
   'An email says you have won a prize and must confirm your bank details now. This is most likely:',
   '["A normal service notification","A phishing scam","A software update message","A backup reminder"]'::jsonb,
   1, 'Unexpected prize claims, urgency and requests for bank or personal details are typical signs of phishing.', 1, 7),
  ('de300000-0000-4000-a000-000000000409', null,
   'de300000-0000-4000-a000-0000000000c1',
   'In a spreadsheet, which formula adds up the values in cells B2 to B10?',
   '["=TOTAL(B2-B10)","=ADD(B2 to B10)","=SUM(B2:B10)","B2 plus B3 plus B4 typed without an equals sign"]'::jsonb,
   2, 'SUM adds a range of cells, and every formula must start with an equals sign: =SUM(B2:B10).', 2, 8),
  ('de300000-0000-4000-a000-000000000410', null,
   'de300000-0000-4000-a000-0000000000c1',
   'Which operating system is the most widely used on smartphones worldwide?',
   '["Android","Windows","macOS","Chrome OS"]'::jsonb,
   0, 'Android is the most widely used mobile operating system in the world, with Apple iOS second.', 1, 9)
on conflict (id) do update set
  topic_id      = excluded.topic_id,
  course_quiz_id = excluded.course_quiz_id,
  prompt        = excluded.prompt,
  choices       = excluded.choices,
  correct_index = excluded.correct_index,
  explanation   = excluded.explanation,
  difficulty    = excluded.difficulty,
  order_index   = excluded.order_index;

-- ----------------------------------------------------------------------------
-- 6. OPTIONAL — lecturer-analytics testing
-- ----------------------------------------------------------------------------
--  By default the demo course has NO lecturer, so the student experience is
--  fully testable but the lecturer dashboards for THIS course are empty (they
--  are scoped to a claimed lecturer slot). Lecturer analytics can still be
--  reviewed on your real course.
--
--  To also test the lecturer side ON the demo course, uncomment the INSERT
--  below, then during signup register a SEPARATE account as a lecturer using
--  Lecturer ID  LECT-DEMO. That account becomes the demo course's lecturer.
--
--  Caveats:
--    * a lecturer account cannot also be a student account (role conflict) —
--      use a different email from your student tester account;
--    * delete_csm_demo_course.sql removes this slot, but a tester account that
--      claimed it stays role 'teacher' (per-user data is not rewritten).
--
-- insert into public.lecturer_slots (lecturer_id, course_id)
-- values ('LECT-DEMO', 'de300000-0000-4000-a000-000000000000')
-- on conflict (lecturer_id) do nothing;

-- ----------------------------------------------------------------------------
-- 7. Confirmation
-- ----------------------------------------------------------------------------
do $$
declare
  v_course uuid := 'de300000-0000-4000-a000-000000000000';
  v_modules int;
  v_lessons int;
  v_mod_q   int;
  v_gcq_q   int;
begin
  select count(*) into v_modules from public.topics where course_id = v_course;
  select count(*) into v_lessons from public.lessons
    where topic_id in (select id from public.topics where course_id = v_course);
  select count(*) into v_mod_q from public.questions
    where topic_id in (select id from public.topics where course_id = v_course);
  select count(*) into v_gcq_q from public.questions
    where course_quiz_id in (select id from public.course_quizzes where course_id = v_course);
  raise notice 'Basic ICT Fundamentals demo seeded: % modules, % lessons, % module-quiz questions, % general-quiz questions.',
    v_modules, v_lessons, v_mod_q, v_gcq_q;
end $$;

commit;

-- ============================================================================
--  Done. Testers can now find "Basic ICT Fundamentals" in the course
--  catalogue and enroll. To remove everything: run delete_csm_demo_course.sql.
-- ============================================================================
