// ../core/router.ts
var PROFILE_PATHS = {
  "/api": "api",
  "/api.php": "api",
  "/article-cover": "api",
  "/article-cover.php": "api",
  "/kano": "kano",
  "/kano.php": "kano",
  "/kano-mobile": "kano",
  "/kano-mobile.php": "kano",
  "/kano-pc": "kano",
  "/kano-pc.php": "kano",
};
var MOBILE_UA_AGENTS = [
  "iPhone",
  "iPod",
  "Android",
  "Windows Phone",
  "BlackBerry",
  "webOS",
  "Mobile",
  "Tablet",
];
function resolveProfileName(pathname) {
  return PROFILE_PATHS[pathname] ?? null;
}
function isMobile(userAgent) {
  if (userAgent === null) return false;
  return MOBILE_UA_AGENTS.some((agent) => userAgent.includes(agent));
}
function resolveAlbum(profile, params, userAgent) {
  const album = params.get("album");
  const validAlbum = album !== null && Object.hasOwn(profile.albums, album) ? album : null;
  if (params.get("type") === "bg") {
    return validAlbum ?? (isMobile(userAgent) ? profile.mobileDefaultAlbum : profile.defaultAlbum);
  }
  return validAlbum ?? profile.defaultAlbum;
}
function selectCdn(profile, referer) {
  if (!profile.diffDomain) return requireCdn(profile, profile.cdnChoose);
  if (referer === null) return requireCdn(profile, "cloudflare");
  let host = null;
  try {
    host = new URL(referer).hostname;
  } catch {
    host = null;
  }
  if (host !== null && profile.refererList.includes(host)) {
    return requireCdn(profile, profile.cdnChoose);
  }
  return requireCdn(profile, "local");
}
function pickImageName(album) {
  const pick = album.images[Math.floor(Math.random() * album.images.length)];
  if (pick === void 0) throw new Error("\u56FE\u96C6\u4E3A\u7A7A");
  return pick;
}
function buildImageUrl(base, album, fileName) {
  return base + album.cdnDir + fileName;
}
function requireCdn(profile, name) {
  const url = profile.cdnList[name];
  if (url === void 0) throw new Error(`cdnList \u7F3A\u5C11 "${name}"`);
  return url;
}

// ../core/handle.ts
async function handle(request, profiles2) {
  const url = new URL(request.url);
  const name = resolveProfileName(url.pathname);
  if (name === null) return text(404, "Not Found");
  try {
    const profile = profiles2[name];
    const albumName = resolveAlbum(profile, url.searchParams, request.headers.get("user-agent"));
    const album = profile.albums[albumName];
    if (album === void 0) return text(500, "Invalid album config");
    const fileName = pickImageName(album);
    if (profile.output === "pass") {
      const originUrl = buildImageUrl(profile.passOrigin, album, fileName);
      try {
        const upstream = await fetch(originUrl);
        if (!upstream.ok) return text(502, "Bad Gateway");
        const headers = new Headers();
        const contentType = upstream.headers.get("content-type");
        if (contentType !== null) headers.set("content-type", contentType);
        return new Response(upstream.body, { status: 200, headers });
      } catch {
        return text(502, "Bad Gateway");
      }
    }
    const base = selectCdn(profile, request.headers.get("referer"));
    return new Response(null, {
      status: 302,
      headers: {
        location: buildImageUrl(base, album, fileName),
        "cache-control": "no-store",
      },
    });
  } catch {
    return text(500, "Internal Server Error");
  }
}
function text(status, body) {
  return new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

// ../core/profiles/api.json
var api_default = {
  output: "cdn",
  cdnChoose: "kksk",
  defaultAlbum: "yuri",
  mobileDefaultAlbum: "kano-vertical",
  diffDomain: false,
  refererList: ["kanochan.net"],
  passOrigin: "https://p.kksk.ltd/tr:w-3840/library-small",
  cdnList: {
    local: "https://api-images.kanochan.net/library",
    cloudflare: "https://image.kanochan.net/library-small",
    kksk: "https://p.kksk.ltd/tr:w-3840/library-small",
  },
  albums: {
    "Genshin-Impact": {
      cdnDir: "/genshin-impact/",
      images: [
        "91247220_p0.webp",
        "88477282_p0.webp",
        "96821803_p0.webp",
        "97555581_p0.webp",
        "95828445_p0.webp",
        "91988144_p0.webp",
        "97313182_p0.webp",
        "100249400_p0.webp",
        "84666651_p0.webp",
        "93077129_p0.webp",
        "93015888_p0.webp",
        "101595682_p0.webp",
        "96542642_p0.webp",
        "93239045_p0.webp",
        "90904448_p0.webp",
        "80172617_p0.webp",
        "92564859_p0.webp",
        "101664845_p0.webp",
        "102169815_p0.webp",
        "89219826_p0.webp",
        "97833640_p0.webp",
        "85339379_p0.webp",
        "85467403_p0.webp",
        "95579662_p0.webp",
        "101414698_p0.webp",
        "84938851_p0.webp",
        "95605647_p0.webp",
        "84808425_p0.webp",
        "91623339_p0.webp",
        "90549488_p0.webp",
        "91364618_p0.webp",
        "92161881_p0.webp",
        "93077711_p0.webp",
        "93113675_p0.webp",
        "95028648_p0.webp",
        "101893893_p0.webp",
        "85984123_p0.webp",
        "95916021_p0.webp",
        "90285518_p0.webp",
        "93604793_p0.webp",
        "89419792_p0.webp",
        "96539574_p0.webp",
        "89490341_p0.webp",
        "95789722_p0.webp",
        "90640803_p0.webp",
        "93200241_p0.webp",
        "102113894_p0.webp",
        "96839227_p0.webp",
        "99693557_p0.webp",
        "87977808_p0.webp",
        "98215752_p0.webp",
        "97312948_p0.webp",
        "97618836_p0.webp",
        "85543107_p0.webp",
        "89261893_p0.webp",
        "97744644_p0.webp",
        "102162661_p0.webp",
        "101036223_p0.webp",
        "85030428_p0.webp",
        "95852258_p0.webp",
        "88695126_p0.webp",
        "88127990_p0.webp",
        "89905880_p0.webp",
        "88450801_p0.webp",
        "92229768_p0.webp",
        "96965922_p0.webp",
        "93187055_p0.webp",
        "94974343_p0.webp",
        "95640265_p0.webp",
        "87550307_p0.webp",
        "92080599_p0.webp",
        "90842631_p0.webp",
        "85998905_p0.webp",
        "93068198_p0.webp",
        "88640994_p0.webp",
        "83935073_p0.webp",
        "101462757_p0.webp",
        "90080062_p0.webp",
        "86644511_p0.webp",
        "83902210_p0.webp",
        "91501751_p0.webp",
        "95732886_p0.webp",
        "84720532_p0.webp",
        "95734855_p0.webp",
        "95527533_p0.webp",
        "80567870_p0.webp",
        "86612443_p0.webp",
        "101157273_p0.webp",
        "84396140_p0.webp",
        "94332366_p0.webp",
        "87541340_p0.webp",
        "85109066_p0.webp",
        "102241526_p0.webp",
        "84699476_p0.webp",
        "93526437_p0.webp",
        "83266050_p0.webp",
        "88504507_p0.webp",
        "101490359_p0.webp",
        "99214743_p0.webp",
        "93414470_p0.webp",
        "84655195_p0.webp",
        "85612639_p0.webp",
        "90575757_p0.webp",
        "96160341_p0.webp",
        "90863688_p0.webp",
        "86221335_p0.webp",
        "101573593_p0.webp",
        "92791077_p0.webp",
        "101462661_p0.webp",
        "79627564_p0.webp",
        "95681846_p0.webp",
        "92004086_p0.webp",
        "96514892_p0.webp",
        "89639050_p0.webp",
        "101553430_p0.webp",
        "84672028_p0.webp",
        "85011957_p0.webp",
        "93083916_p0.webp",
        "84824171_p0.webp",
        "93798842_p0.webp",
        "83658524_p0.webp",
        "100784767_p0.webp",
      ],
    },
    yuri: {
      cdnDir: "/yuri/",
      images: [
        "83928473_p0.webp",
        "102567973_p0.webp",
        "82542737_p0.webp",
        "91194235_p0.webp",
        "60537176_p0.webp",
        "97333993_p0.webp",
        "78612478_p0.webp",
        "56907845_p0.webp",
        "89172772_p1.webp",
        "93122161_p0.webp",
        "94908514_p0.webp",
        "87857349_p0.webp",
        "94106688_p0.webp",
        "84571732_p0.webp",
        "100475697_p0.webp",
        "87710894_p0.webp",
        "99192203_p0.webp",
        "94118936_p0.webp",
        "88603735_p0.webp",
        "68146165_p0.webp",
        "94277636_p0.webp",
        "83245109_p0.webp",
        "83419740_p0.webp",
        "96080487_p0.webp",
        "64535082_p0.webp",
        "83088427_p0.webp",
        "100385857_p0.webp",
        "87108518_p0.webp",
        "85769778_p0.webp",
        "85397299_p0.webp",
        "100339292_p0.webp",
        "61198628_p0.webp",
        "99906124_p0.webp",
        "97083888_p0.webp",
        "100056160_p0.webp",
        "78341619_p0.webp",
        "88609517_p1.webp",
        "91885680_p0.webp",
        "100236457_p0.webp",
        "98259659_p0.webp",
        "74451788_p0.webp",
        "22386076_p0.webp",
        "74010555_p0.webp",
        "99870140_p0.webp",
        "85262834_p0.webp",
        "98089060_p0.webp",
        "37320565_p0.webp",
        "85077923_p0.webp",
        "94173069_p0.webp",
        "94955814_p0.webp",
        "77240141_p0.webp",
        "85524069_p0.webp",
        "78875099_p0.webp",
        "79906379_p0.webp",
        "100567610_p0.webp",
        "77734148_p0.webp",
        "59649097_p0.webp",
        "98281111_p0.webp",
        "100039624_p0.webp",
        "101473348_p0.webp",
        "85460920_p0.webp",
        "86141867_p0.webp",
        "76771613_p0.webp",
        "80567870_p0.webp",
        "100960965_p0.webp",
        "91191150_p0.webp",
        "100930872_p0.webp",
        "97495003_p0.webp",
        "82135005_p0.webp",
        "87745777_p0.webp",
        "74635611_p0.webp",
        "97146726_p0.webp",
        "102825244_p0.webp",
        "78173773_p0.webp",
        "97941568_p0.webp",
        "75854071_p0.webp",
        "79851098_p0.webp",
        "73081851_p0.webp",
        "80598441_p0.webp",
        "96099152_p0.webp",
        "90153492_p0.webp",
        "85465269_p0.webp",
        "85376171_p0.webp",
        "101811971_p0.webp",
        "62519151_p0.webp",
        "89172772_p2.webp",
        "100376755_p0.webp",
        "94394808_p0.webp",
        "70246393_p0.webp",
        "78491685_p0.webp",
        "65293627_p0.webp",
        "83101983_p0.webp",
        "100780504_p0.webp",
        "85730157_p1.webp",
        "84350788_p0.webp",
        "72300506_p0.webp",
        "91303180_p0.webp",
        "77359441_p0.webp",
        "69938888_p0.webp",
        "98201866_p0.webp",
        "99435308_p0.webp",
      ],
    },
    "kano-horizontal": {
      cdnDir: "/kano/horizontal/",
      images: [
        "kano_pc_28.webp",
        "kano_pc_25.webp",
        "kano_pc_18.webp",
        "kano_pc_23.webp",
        "kano_pc_09.webp",
        "kano_pc_31.webp",
        "kano_pc_03.webp",
        "kano_pc_12.webp",
        "kano_pc_27.webp",
        "kano_pc_32.webp",
        "kano_pc_19.webp",
        "kano_pc_15.webp",
        "kano_pc_29.webp",
        "kano_pc_21.webp",
        "kano_pc_11.webp",
        "kano_pc_26.webp",
        "kano_pc_13.webp",
        "kano_pc_16.webp",
        "kano_pc_02.webp",
        "kano_pc_17.webp",
        "kano_pc_07.webp",
        "kano_pc_30.webp",
        "kano_pc_06.webp",
        "kano_pc_04.webp",
        "kano_pc_24.webp",
        "kano_pc_01.webp",
        "kano_pc_20.webp",
        "kano_pc_14.webp",
        "kano_pc_05.webp",
        "kano_pc_10.webp",
        "kano_pc_08.webp",
        "kano_pc_22.webp",
      ],
    },
    "kano-vertical": {
      cdnDir: "/kano/vertical/",
      images: [
        "kano_mobile_05.webp",
        "kano_mobile_06.webp",
        "kano_mobile_02.webp",
        "kano_mobile_04.webp",
        "kano_mobile_01.webp",
        "kano_mobile_03.webp",
      ],
    },
  },
};

// ../core/profiles/kano.json
var kano_default = {
  output: "cdn",
  cdnChoose: "kksk",
  defaultAlbum: "kano-horizontal",
  mobileDefaultAlbum: "kano-vertical",
  diffDomain: false,
  refererList: ["kanochan.net"],
  passOrigin: "https://p.kksk.ltd/library-small",
  cdnList: {
    local: "https://api-images.kanochan.net/library",
    miui: "https://cdn.miui.ink/img/api-200",
    cloudflare: "https://image.kanochan.net/library",
    hellonewworld: "https://api.hellonewworld.net/iro/KanoChan/library",
    ilulu: "https://cdn.ilulu.ink/img/api-100",
    laiyun: "https://contents.kanochan.net/api-img/library",
    catimg: "https://apii.ctose.cn/tu/library",
    kksk: "https://p.kksk.ltd/library-small",
  },
  albums: {
    "Genshin-Impact": {
      cdnDir: "/genshin-impact/",
      images: [
        "91247220_p0.webp",
        "88477282_p0.webp",
        "96821803_p0.webp",
        "97555581_p0.webp",
        "95828445_p0.webp",
        "91988144_p0.webp",
        "97313182_p0.webp",
        "100249400_p0.webp",
        "84666651_p0.webp",
        "93077129_p0.webp",
        "93015888_p0.webp",
        "101595682_p0.webp",
        "96542642_p0.webp",
        "93239045_p0.webp",
        "90904448_p0.webp",
        "80172617_p0.webp",
        "92564859_p0.webp",
        "101664845_p0.webp",
        "102169815_p0.webp",
        "89219826_p0.webp",
        "97833640_p0.webp",
        "85339379_p0.webp",
        "85467403_p0.webp",
        "95579662_p0.webp",
        "101414698_p0.webp",
        "84938851_p0.webp",
        "95605647_p0.webp",
        "84808425_p0.webp",
        "91623339_p0.webp",
        "90549488_p0.webp",
        "91364618_p0.webp",
        "92161881_p0.webp",
        "93077711_p0.webp",
        "93113675_p0.webp",
        "95028648_p0.webp",
        "101893893_p0.webp",
        "85984123_p0.webp",
        "95916021_p0.webp",
        "90285518_p0.webp",
        "93604793_p0.webp",
        "89419792_p0.webp",
        "96539574_p0.webp",
        "89490341_p0.webp",
        "95789722_p0.webp",
        "90640803_p0.webp",
        "93200241_p0.webp",
        "102113894_p0.webp",
        "96839227_p0.webp",
        "99693557_p0.webp",
        "87977808_p0.webp",
        "98215752_p0.webp",
        "97312948_p0.webp",
        "97618836_p0.webp",
        "85543107_p0.webp",
        "89261893_p0.webp",
        "97744644_p0.webp",
        "102162661_p0.webp",
        "101036223_p0.webp",
        "85030428_p0.webp",
        "95852258_p0.webp",
        "88695126_p0.webp",
        "88127990_p0.webp",
        "89905880_p0.webp",
        "88450801_p0.webp",
        "92229768_p0.webp",
        "96965922_p0.webp",
        "93187055_p0.webp",
        "94974343_p0.webp",
        "95640265_p0.webp",
        "87550307_p0.webp",
        "92080599_p0.webp",
        "90842631_p0.webp",
        "85998905_p0.webp",
        "93068198_p0.webp",
        "88640994_p0.webp",
        "83935073_p0.webp",
        "101462757_p0.webp",
        "90080062_p0.webp",
        "86644511_p0.webp",
        "83902210_p0.webp",
        "91501751_p0.webp",
        "95732886_p0.webp",
        "84720532_p0.webp",
        "95734855_p0.webp",
        "95527533_p0.webp",
        "80567870_p0.webp",
        "86612443_p0.webp",
        "101157273_p0.webp",
        "84396140_p0.webp",
        "94332366_p0.webp",
        "87541340_p0.webp",
        "85109066_p0.webp",
        "102241526_p0.webp",
        "84699476_p0.webp",
        "93526437_p0.webp",
        "83266050_p0.webp",
        "88504507_p0.webp",
        "101490359_p0.webp",
        "99214743_p0.webp",
        "93414470_p0.webp",
        "84655195_p0.webp",
        "85612639_p0.webp",
        "90575757_p0.webp",
        "96160341_p0.webp",
        "90863688_p0.webp",
        "86221335_p0.webp",
        "101573593_p0.webp",
        "92791077_p0.webp",
        "101462661_p0.webp",
        "79627564_p0.webp",
        "95681846_p0.webp",
        "92004086_p0.webp",
        "96514892_p0.webp",
        "89639050_p0.webp",
        "101553430_p0.webp",
        "84672028_p0.webp",
        "85011957_p0.webp",
        "93083916_p0.webp",
        "84824171_p0.webp",
        "93798842_p0.webp",
        "83658524_p0.webp",
        "100784767_p0.webp",
      ],
    },
    yuri: {
      cdnDir: "/yuri/",
      images: [
        "83928473_p0.webp",
        "102567973_p0.webp",
        "82542737_p0.webp",
        "91194235_p0.webp",
        "60537176_p0.webp",
        "97333993_p0.webp",
        "78612478_p0.webp",
        "56907845_p0.webp",
        "89172772_p1.webp",
        "93122161_p0.webp",
        "94908514_p0.webp",
        "87857349_p0.webp",
        "94106688_p0.webp",
        "84571732_p0.webp",
        "100475697_p0.webp",
        "87710894_p0.webp",
        "99192203_p0.webp",
        "74822118_p0.webp",
        "94118936_p0.webp",
        "88603735_p0.webp",
        "68146165_p0.webp",
        "94277636_p0.webp",
        "83245109_p0.webp",
        "83419740_p0.webp",
        "99066456_p0.webp",
        "96080487_p0.webp",
        "64535082_p0.webp",
        "83088427_p0.webp",
        "100385857_p0.webp",
        "98717421_p0.webp",
        "101704443_p0.webp",
        "87108518_p0.webp",
        "85769778_p0.webp",
        "85397299_p0.webp",
        "100339292_p0.webp",
        "61198628_p0.webp",
        "99906124_p0.webp",
        "97083888_p0.webp",
        "100056160_p0.webp",
        "78341619_p0.webp",
        "88609517_p1.webp",
        "91885680_p0.webp",
        "100236457_p0.webp",
        "98259659_p0.webp",
        "74451788_p0.webp",
        "22386076_p0.webp",
        "74010555_p0.webp",
        "99870140_p0.webp",
        "85262834_p0.webp",
        "98089060_p0.webp",
        "37320565_p0.webp",
        "85077923_p0.webp",
        "94173069_p0.webp",
        "94955814_p0.webp",
        "77240141_p0.webp",
        "85524069_p0.webp",
        "78875099_p0.webp",
        "79906379_p0.webp",
        "100567610_p0.webp",
        "77734148_p0.webp",
        "59649097_p0.webp",
        "98281111_p0.webp",
        "100039624_p0.webp",
        "101473348_p0.webp",
        "85460920_p0.webp",
        "86141867_p0.webp",
        "76771613_p0.webp",
        "80567870_p0.webp",
        "100960965_p0.webp",
        "91191150_p0.webp",
        "100930872_p0.webp",
        "78663174_p0.webp",
        "97495003_p0.webp",
        "82135005_p0.webp",
        "87745777_p0.webp",
        "74635611_p0.webp",
        "97146726_p0.webp",
        "102825244_p0.webp",
        "100365012_p0.webp",
        "78173773_p0.webp",
        "97941568_p0.webp",
        "75854071_p0.webp",
        "79851098_p0.webp",
        "73081851_p0.webp",
        "80598441_p0.webp",
        "96099152_p0.webp",
        "90153492_p0.webp",
        "85465269_p0.webp",
        "85376171_p0.webp",
        "101811971_p0.webp",
        "62519151_p0.webp",
        "89172772_p2.webp",
        "100376755_p0.webp",
        "94394808_p0.webp",
        "70246393_p0.webp",
        "78491685_p0.webp",
        "65293627_p0.webp",
        "83101983_p0.webp",
        "100780504_p0.webp",
        "85730157_p1.webp",
        "84350788_p0.webp",
        "72300506_p0.webp",
        "91303180_p0.webp",
        "77359441_p0.webp",
        "69938888_p0.webp",
        "98201866_p0.webp",
        "99435308_p0.webp",
      ],
    },
    "kano-horizontal": {
      cdnDir: "/kano/horizontal/",
      images: [
        "kano_pc_28.webp",
        "kano_pc_25.webp",
        "kano_pc_18.webp",
        "kano_pc_23.webp",
        "kano_pc_09.webp",
        "kano_pc_31.webp",
        "kano_pc_03.webp",
        "kano_pc_12.webp",
        "kano_pc_27.webp",
        "kano_pc_32.webp",
        "kano_pc_19.webp",
        "kano_pc_15.webp",
        "kano_pc_29.webp",
        "kano_pc_21.webp",
        "kano_pc_11.webp",
        "kano_pc_26.webp",
        "kano_pc_13.webp",
        "kano_pc_16.webp",
        "kano_pc_02.webp",
        "kano_pc_17.webp",
        "kano_pc_07.webp",
        "kano_pc_30.webp",
        "kano_pc_06.webp",
        "kano_pc_04.webp",
        "kano_pc_24.webp",
        "kano_pc_01.webp",
        "kano_pc_20.webp",
        "kano_pc_14.webp",
        "kano_pc_05.webp",
        "kano_pc_10.webp",
        "kano_pc_08.webp",
        "kano_pc_22.webp",
      ],
    },
    "kano-vertical": {
      cdnDir: "/kano/vertical/",
      images: [
        "kano_mobile_05.webp",
        "kano_mobile_06.webp",
        "kano_mobile_02.webp",
        "kano_mobile_04.webp",
        "kano_mobile_01.webp",
        "kano_mobile_03.webp",
      ],
    },
  },
};

// ../core/registry.ts
var profiles = {
  api: parseProfile(api_default, "api"),
  kano: parseProfile(kano_default, "kano"),
};
function parseProfile(raw, name) {
  const o = asRecord(raw, name);
  const output = asString(o.output, `${name}.output`);
  if (output !== "cdn" && output !== "pass") {
    throw new Error(`${name}.output: \u671F\u671B "cdn" \u6216 "pass"`);
  }
  const cdnList = {};
  for (const [key, value] of Object.entries(asRecord(o.cdnList, `${name}.cdnList`))) {
    cdnList[key] = asString(value, `${name}.cdnList.${key}`);
  }
  const albums = {};
  for (const [key, value] of Object.entries(asRecord(o.albums, `${name}.albums`))) {
    const albumObj = asRecord(value, `${name}.albums.${key}`);
    const images = asStringArray(albumObj.images, `${name}.albums.${key}.images`);
    if (images.length === 0) {
      throw new Error(`${name}.albums.${key}.images: \u56FE\u96C6\u4E3A\u7A7A`);
    }
    albums[key] = {
      cdnDir: asString(albumObj.cdnDir, `${name}.albums.${key}.cdnDir`),
      images,
    };
  }
  const defaultAlbum = asString(o.defaultAlbum, `${name}.defaultAlbum`);
  const mobileDefaultAlbum = asString(o.mobileDefaultAlbum, `${name}.mobileDefaultAlbum`);
  for (const albumName of [defaultAlbum, mobileDefaultAlbum]) {
    if (!Object.hasOwn(albums, albumName)) {
      throw new Error(
        `${name}: \u9ED8\u8BA4\u56FE\u96C6 "${albumName}" \u4E0D\u5728 albums \u4E2D`,
      );
    }
  }
  const cdnChoose = asString(o.cdnChoose, `${name}.cdnChoose`);
  if (cdnList[cdnChoose] === void 0) {
    throw new Error(`${name}: cdnChoose "${cdnChoose}" \u4E0D\u5728 cdnList \u4E2D`);
  }
  return {
    output,
    cdnChoose,
    defaultAlbum,
    mobileDefaultAlbum,
    diffDomain: o.diffDomain === true,
    refererList: asStringArray(o.refererList, `${name}.refererList`),
    passOrigin: asString(o.passOrigin, `${name}.passOrigin`),
    cdnList,
    albums,
  };
}
function asRecord(value, path) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${path}: \u671F\u671B\u5BF9\u8C61`);
  }
  return value;
}
function asString(value, path) {
  if (typeof value !== "string") throw new Error(`${path}: \u671F\u671B\u5B57\u7B26\u4E32`);
  return value;
}
function asStringArray(value, path) {
  if (!Array.isArray(value)) throw new Error(`${path}: \u671F\u671B\u6570\u7EC4`);
  return value.map((item, index) => asString(item, `${path}[${index}]`));
}

// entry.ts
var entry_default = {
  fetch(request) {
    return handle(request, profiles);
  },
};
export { entry_default as default };
