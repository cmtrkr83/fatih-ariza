export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
}

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function genCode(len = 6): string {
  const arr = crypto.getRandomValues(new Uint8Array(len));
  return Array.from(arr, (b) => CODE_ALPHABET[b % CODE_ALPHABET.length]).join("");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

async function findSchoolByCode(db: D1Database, code: string) {
  const clean = (code || "").trim().toUpperCase();
  if (!clean) return null;
  return await db
    .prepare("SELECT * FROM schools WHERE teacher_code = ?1 OR admin_code = ?2")
    .bind(clean, clean)
    .first();
}

function roleFor(school: any, code: string): "admin" | "teacher" | null {
  const clean = (code || "").trim().toUpperCase();
  if (!school || !clean) return null;
  if (clean === school.admin_code) return "admin";
  if (clean === school.teacher_code) return "teacher";
  return null;
}

async function addLog(
  db: D1Database,
  e: { school_id: string; fault_id?: string | null; actor_name?: string | null; actor_role: string; action: string; detail?: string | null; created_at?: number }
) {
  await db
    .prepare(
      "INSERT INTO logs (id, school_id, fault_id, actor_name, actor_role, action, detail, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)"
    )
    .bind(
      crypto.randomUUID(),
      e.school_id,
      e.fault_id || null,
      e.actor_name || null,
      e.actor_role,
      e.action,
      e.detail || null,
      e.created_at || Date.now()
    )
    .run();
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    // --- API routes ---
    if (url.pathname.startsWith("/api/")) {
      try {
        // POST /api/schools -> sorumlu okul kaydeder, 2 kod üretilir
        if (url.pathname === "/api/schools" && request.method === "POST") {
          const body: any = await request.json().catch(() => ({}));
          const name = (body.name || "").trim();
          if (name.length < 2) return json({ error: "Okul adı en az 2 karakter olmalı." }, 400);

          for (let attempt = 0; attempt < 5; attempt++) {
            const id = crypto.randomUUID();
            const teacher_code = genCode(6);
            const admin_code = genCode(6);
            const now = Date.now();
            try {
              await env.DB.prepare(
                "INSERT INTO schools (id, name, teacher_code, admin_code, created_at) VALUES (?1, ?2, ?3, ?4, ?5)"
              )
                .bind(id, name, teacher_code, admin_code, now)
                .run();
              return json({ school: { id, name, teacherCode: teacher_code, adminCode: admin_code } }, 201);
            } catch (e: any) {
              // UNIQUE çakışması olursa tekrar dene
              if (!String(e?.message || "").includes("UNIQUE")) throw e;
            }
          }
          return json({ error: "Kod üretilirken çakışma oldu, tekrar deneyin." }, 500);
        }

        // POST /api/join -> {code} ile okula bağlan
        if (url.pathname === "/api/join" && request.method === "POST") {
          const body: any = await request.json().catch(() => ({}));
          const school: any = await findSchoolByCode(env.DB, body.code || "");
          if (!school) return json({ error: "Kod bulunamadı. Kodu kontrol edin." }, 404);
          const role = roleFor(school, body.code);
          return json({
            school: { id: school.id, name: school.name },
            role,
            code: (body.code || "").trim().toUpperCase(),
            // admin girişinde öğretmenlere dağıtılacak kodu da dön ki panelde görünsün
            teacherCode: role === "admin" ? school.teacher_code : undefined,
          });
        }

        // GET /api/faults?schoolId=..&code=..&teacherToken=..&teacherName=.. -> sorumlu hepsini, öğretmen sadece kendininkini görür
        if (url.pathname === "/api/faults" && request.method === "GET") {
          const schoolId = url.searchParams.get("schoolId") || "";
          const code = url.searchParams.get("code") || "";
          const teacherToken = (url.searchParams.get("teacherToken") || "").trim();
          const teacherName = (url.searchParams.get("teacherName") || "").trim();
          const school: any = await env.DB.prepare("SELECT * FROM schools WHERE id = ?1")
            .bind(schoolId)
            .first();
          if (!school) return json({ error: "Okul bulunamadı." }, 404);
          const role = roleFor(school, code);
          if (!role) return json({ error: "Yetkisiz erişim." }, 403);
          const SELECT_COLS =
            "SELECT id, teacher_name AS teacherName, status, location, category, description, created_at AS createdAt FROM faults WHERE school_id = ?1";
          let rows;
          if (role === "admin") {
            rows = await env.DB.prepare(SELECT_COLS + " ORDER BY created_at DESC LIMIT 200")
              .bind(schoolId)
              .all();
          } else {
            // öğretmen: sadece kendi arızaları (token eşleşmesi; eski kayıtlar için isim fallback)
            if (teacherToken) {
              rows = await env.DB.prepare(
                SELECT_COLS + " AND (teacher_token = ?2 OR (teacher_token IS NULL AND teacher_name = ?3)) ORDER BY created_at DESC LIMIT 200"
              )
                .bind(schoolId, teacherToken, teacherName)
                .all();
            } else {
              rows = await env.DB.prepare(SELECT_COLS + " AND teacher_name = ?2 ORDER BY created_at DESC LIMIT 200")
                .bind(schoolId, teacherName)
                .all();
            }
          }
          return json({
            faults: rows.results || [],
            teacherCode: role === "admin" ? school.teacher_code : undefined,
          });
        }

        // POST /api/faults -> öğretmen arıza bildirir (sadece kendisi + sorumlu görür)
        if (url.pathname === "/api/faults" && request.method === "POST") {
          const body: any = await request.json().catch(() => ({}));
          const { schoolId, code, teacherName, teacherToken, location, category, description } = body;
          const school: any = await env.DB.prepare("SELECT * FROM schools WHERE id = ?1")
            .bind(schoolId || "")
            .first();
          if (!school) return json({ error: "Okul bulunamadı." }, 404);
          if (!roleFor(school, code || "")) return json({ error: "Yetkisiz erişim." }, 403);
          if ((teacherName || "").trim().length < 2) return json({ error: "Ad Soyad gerekli." }, 400);
          if ((location || "").trim().length < 2) return json({ error: "Derslik / Konum gerekli." }, 400);
          if ((category || "").trim().length < 2) return json({ error: "Kategori seçin." }, 400);
          if ((description || "").trim().length < 3) return json({ error: "Arıza açıklaması gerekli." }, 400);

          const id = crypto.randomUUID();
          const now = Date.now();
          await env.DB.prepare(
            "INSERT INTO faults (id, school_id, teacher_name, teacher_token, status, location, category, description, created_at) VALUES (?1, ?2, ?3, ?4, 'bekliyor', ?5, ?6, ?7, ?8)"
          )
            .bind(id, schoolId, teacherName.trim(), (teacherToken || "").trim() || null, location.trim(), category.trim(), description.trim(), now)
            .run();
          await addLog(env.DB, {
            school_id: schoolId,
            fault_id: id,
            actor_name: teacherName.trim(),
            actor_role: "teacher",
            action: "oluşturuldu",
            detail: `${category.trim()} • ${location.trim()} • ${description.trim().slice(0, 120)}`,
            created_at: now,
          });
          return json({ ok: true, id }, 201);
        }

        // PATCH /api/faults/:id -> sorumlu durum etiketler (bekliyor / inceleniyor / çözüldü)
        if (url.pathname.startsWith("/api/faults/") && request.method === "PATCH") {
          const id = url.pathname.split("/").pop() || "";
          const body: any = await request.json().catch(() => ({}));
          const { schoolId, code, status } = body;
          const allowed = ["bekliyor", "inceleniyor", "çözüldü"];
          if (!allowed.includes(status)) return json({ error: "Geçersiz durum." }, 400);
          const school: any = await env.DB.prepare("SELECT * FROM schools WHERE id = ?1")
            .bind(schoolId || "")
            .first();
          if (!school) return json({ error: "Okul bulunamadı." }, 404);
          if (roleFor(school, code || "") !== "admin")
            return json({ error: "Sadece sorumlu durum değiştirebilir." }, 403);
          const fault: any = await env.DB.prepare(
            "SELECT teacher_name, category, location FROM faults WHERE id = ?1 AND school_id = ?2"
          )
            .bind(id, schoolId)
            .first();
          await env.DB.prepare("UPDATE faults SET status = ?1 WHERE id = ?2 AND school_id = ?3")
            .bind(status, id, schoolId)
            .run();
          await addLog(env.DB, {
            school_id: schoolId as string,
            fault_id: id,
            actor_name: "Sorumlu",
            actor_role: "admin",
            action: status,
            detail: fault ? `${fault.category} • ${fault.location} (${fault.teacher_name})` : null,
          });
          return json({ ok: true });
        }

        // DELETE /api/faults/:id?schoolId=..&code=.. -> sadece sorumlu silebilir (çözüldü)
        if (url.pathname.startsWith("/api/faults/") && request.method === "DELETE") {
          const id = url.pathname.split("/").pop() || "";
          const schoolId = url.searchParams.get("schoolId") || "";
          const code = url.searchParams.get("code") || "";
          const school: any = await env.DB.prepare("SELECT * FROM schools WHERE id = ?1")
            .bind(schoolId)
            .first();
          if (!school) return json({ error: "Okul bulunamadı." }, 404);
          if (roleFor(school, code) !== "admin")
            return json({ error: "Sadece sorumlu arıza silebilir." }, 403);
          const doomed: any = await env.DB.prepare(
            "SELECT teacher_name, category, location, description FROM faults WHERE id = ?1 AND school_id = ?2"
          )
            .bind(id, schoolId)
            .first();
          await env.DB.prepare("DELETE FROM faults WHERE id = ?1 AND school_id = ?2")
            .bind(id, schoolId)
            .run();
          await addLog(env.DB, {
            school_id: schoolId,
            fault_id: id,
            actor_name: "Sorumlu",
            actor_role: "admin",
            action: "silindi",
            detail: doomed
              ? `${doomed.category} • ${doomed.location} (${doomed.teacher_name}) • ${String(doomed.description || "").slice(0, 120)}`
              : null,
          });
          return json({ ok: true });
        }

        // GET /api/report?schoolId=..&code=..&from=YYYY-MM-DD&to=YYYY-MM-DD -> sorumlu tarih aralıklı işlem raporu
        if (url.pathname === "/api/report" && request.method === "GET") {
          const schoolId = url.searchParams.get("schoolId") || "";
          const code = url.searchParams.get("code") || "";
          const fromStr = url.searchParams.get("from") || "";
          const toStr = url.searchParams.get("to") || "";
          const school: any = await env.DB.prepare("SELECT * FROM schools WHERE id = ?1")
            .bind(schoolId)
            .first();
          if (!school) return json({ error: "Okul bulunamadı." }, 404);
          if (roleFor(school, code) !== "admin")
            return json({ error: "Sadece sorumlu rapor alabilir." }, 403);
          const parseDay = (s: string, end: boolean) => {
            const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || "");
            if (!m) return null;
            const t = Date.UTC(+m[1], +m[2] - 1, +m[3], end ? 23 : 0, end ? 59 : 0, end ? 59 : 0, end ? 999 : 0);
            return Number.isNaN(t) ? null : t;
          };
          const from = parseDay(fromStr, false);
          const to = parseDay(toStr, true);
          if (from === null || to === null) return json({ error: "Geçerli Başlangıç/Bitiş tarihi seçin (YYYY-AA-GG)." }, 400);
          if (to < from) return json({ error: "Bitiş tarihi başlangıçtan önce olamaz." }, 400);
          if (to - from > 366 * 86400000) return json({ error: "En fazla 1 yıllık aralık seçin." }, 400);
          const rows = await env.DB.prepare(
            "SELECT id, fault_id AS faultId, actor_name AS actorName, actor_role AS actorRole, action, detail, created_at AS createdAt FROM logs WHERE school_id = ?1 AND created_at >= ?2 AND created_at <= ?3 ORDER BY created_at ASC LIMIT 2000"
          )
            .bind(schoolId, from, to)
            .all();
          const items = (rows.results || []) as any[];
          const summary: Record<string, number> = {};
          for (const it of items) summary[it.action] = (summary[it.action] || 0) + 1;
          return json({ school: school.name, from: fromStr, to: toStr, total: items.length, summary, items });
        }

        return json({ error: "Bilinmeyen API." }, 404);
      } catch (e: any) {
        console.error(e);
        return json({ error: "Sunucu hatası: " + (e?.message || e) }, 500);
      }
    }

    // --- Static single page ---
    return env.ASSETS.fetch(request);
  },
};
