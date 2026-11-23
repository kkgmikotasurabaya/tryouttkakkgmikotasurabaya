import { createTursoClient, jsonResponse } from '../_turso.js';

let cacheStore = {
  examPack: {},
  examKeys: {},
  lastFetchTime: 0
};
const CACHE_TTL = 5 * 60 * 1000;

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const turso = createTursoClient(env);
    const { action, args = [] } = await request.json();

    if (action === 'getLandingData') {
      try {
        const settings = await turso.execute("SELECT * FROM Settings WHERE KeyName IN ('SesiAktif', 'JamSesi1', 'JamSesi2', 'JamSesi3')");
        let data = { SesiAktif: '1', JamSesi1: '07.30 - 09.00', JamSesi2: '09.30 - 11.00', JamSesi3: '11.30 - 13.00' };
        settings.rows.forEach(r => { data[r.KeyName] = r.KeyValue; });
        return jsonResponse({ status: 'success', data });
      } catch (e) {
        return jsonResponse({ status: 'success', data: { SesiAktif: '1', JamSesi1: '07.30 - 09.00', JamSesi2: '09.30 - 11.00', JamSesi3: '11.30 - 13.00' } });
      }
    }

    if (action === 'adminUpdateSesiGlobal') {
      const newSesi = args[0] || '1';
      await turso.execute("CREATE TABLE IF NOT EXISTS Settings (KeyName VARCHAR(50) PRIMARY KEY, KeyValue VARCHAR(255))");
      await turso.execute({ sql: "INSERT OR REPLACE INTO Settings (KeyName, KeyValue) VALUES ('SesiAktif', ?)", args: [newSesi] });
      return jsonResponse({ status: 'success', msg: 'Sesi Aktif Berhasil Diperbarui' });
    }

    if (action === 'adminUpdateJamSesi') {
      const { s1, s2, s3 } = args[0];
      await turso.execute("CREATE TABLE IF NOT EXISTS Settings (KeyName VARCHAR(50) PRIMARY KEY, KeyValue VARCHAR(255))");
      await turso.batch([
        { sql: "INSERT OR REPLACE INTO Settings (KeyName, KeyValue) VALUES ('JamSesi1', ?)", args: [s1 || ''] },
        { sql: "INSERT OR REPLACE INTO Settings (KeyName, KeyValue) VALUES ('JamSesi2', ?)", args: [s2 || ''] },
        { sql: "INSERT OR REPLACE INTO Settings (KeyName, KeyValue) VALUES ('JamSesi3', ?)", args: [s3 || ''] }
      ]);
      return jsonResponse({ status: 'success', msg: 'Jam Sesi Berhasil Diperbarui' });
    }

    if (action === 'registerGuru') {
      const d = args[0];
      const id = 'G' + Date.now();
      const cek = await turso.execute({ sql: "SELECT Username FROM Users WHERE Username = ?", args: [d.username || ''] });
      if (cek.rows.length > 0) return jsonResponse({ status: 'error', msg: 'Username tersebut sudah terpakai!' });
      await turso.execute({
        sql: "INSERT INTO Users (ID, Nama, Username, Password, Role, Sekolah, StatusApproval, KuotaSiswa, NoHP) VALUES (?, ?, ?, ?, 'guru', ?, 'Pending', 0, ?)",
        args: [id, d.nama || '', d.username || '', d.password || '', d.sekolah || '', d.noHP || '']
      });
      return jsonResponse({ status: 'success', msg: 'Akun berhasil dibuat. Silakan Login menggunakan Username Anda.' });
    }

    if (action === 'submitQuota') {
      const d = args[0];
      await turso.execute({ sql: "UPDATE Users SET KuotaSiswa = ? WHERE ID = ?", args: [Number(d.jumlahSiswa) || 0, d.guruId || ''] });
      await turso.execute("CREATE TABLE IF NOT EXISTS Payments (PaymentID VARCHAR(50) PRIMARY KEY, GuruID VARCHAR(50), JumlahSiswa INT, Tanggal DATETIME)");
      await turso.execute({
        sql: "INSERT INTO Payments (PaymentID, GuruID, JumlahSiswa, Tanggal) VALUES (?, ?, ?, CURRENT_TIMESTAMP)",
        args: ['PAY' + Date.now(), d.guruId || '', Number(d.jumlahSiswa) || 0]
      });
      return jsonResponse({ status: 'success' });
    }

    if (action === 'getPersetujuanList') {
      const list = await turso.execute("SELECT ID, Nama, Username, Password, Role, Sekolah, NoHP, KuotaSiswa, StatusApproval FROM Users WHERE Role='guru' AND StatusApproval='Pending' ORDER BY ROWID DESC");
      return jsonResponse({ status: 'success', data: list.rows });
    }

    if (action === 'adminApproveGuru') {
      await turso.execute({ sql: "UPDATE Users SET StatusApproval = 'Approved' WHERE ID = ?", args: [args[0] || ''] });
      return jsonResponse({ status: 'success', msg: 'Berhasil disetujui.' });
    }

    if (action === 'getDashboardData') {
      const [role, userId, , sekolah, filterMapel] = args;
      const exams = await turso.execute("SELECT ExamID, Judul, Mapel, TargetKelas, Durasi, Token, StartDate, EndDate, Status, AllowDownloadQ FROM Exams WHERE Mapel != 'SURVEY'");
      let output = { logo: 'https://lh3.googleusercontent.com/d/1VJINoN5yi1uc1pRZ5SPrM19gIS2iPhQh' };

      try {
        const settings = await turso.execute("SELECT KeyName, KeyValue FROM Settings WHERE KeyName IN ('SesiAktif', 'JamSesi1', 'JamSesi2', 'JamSesi3')");
        output.sesiAktif = '1'; output.jamSesi1 = '07.30 - 09.00'; output.jamSesi2 = '09.30 - 11.00'; output.jamSesi3 = '11.30 - 13.00';
        settings.rows.forEach(r => {
          if (r.KeyName === 'SesiAktif') output.sesiAktif = r.KeyValue;
          if (r.KeyName === 'JamSesi1') output.jamSesi1 = r.KeyValue;
          if (r.KeyName === 'JamSesi2') output.jamSesi2 = r.KeyValue;
          if (r.KeyName === 'JamSesi3') output.jamSesi3 = r.KeyValue;
        });
      } catch (e) {}

      if (role === 'admin' || role === 'guru') {
        const summaryQuery = role === 'guru'
          ? await turso.execute({ sql: "SELECT COALESCE(NULLIF(TRIM(Sekolah), ''), 'Tanpa Sekolah') as Sekolah, COUNT(*) as Jumlah FROM Users WHERE Role = 'siswa' AND LOWER(TRIM(Sekolah)) = LOWER(TRIM(?)) GROUP BY TRIM(Sekolah)", args: [sekolah || ''] })
          : await turso.execute("SELECT COALESCE(NULLIF(TRIM(Sekolah), ''), 'Tanpa Sekolah') as Sekolah, COUNT(*) as Jumlah FROM Users WHERE Role = 'siswa' GROUP BY TRIM(Sekolah) ORDER BY Jumlah DESC");

        const totalSiswaCount = summaryQuery.rows.reduce((acc, row) => acc + Number(row.Jumlah || 0), 0);
        output.exams = exams.rows;
        output.stats = {
          totalSiswa: totalSiswaCount,
          totalUjian: exams.rows.length,
          activeUjian: exams.rows.filter(e => e.Status === 'Aktif').length
        };
        output.schoolSummary = summaryQuery.rows;

        let sqlRank = `SELECT u.Sekolah, AVG(r.TotalNilai) as RataRata FROM Results r JOIN Users u ON r.SiswaID = u.ID JOIN Exams e ON r.ExamID = e.ExamID WHERE e.Mapel != 'SURVEY'`;
        let rankArgs = [];
        if (role === 'guru') sqlRank += " AND e.ShowStats IN ('Yes', 'Aktif')";
        if (filterMapel && filterMapel !== 'ALL') { sqlRank += " AND e.Mapel = ?"; rankArgs.push(filterMapel); }
        sqlRank += " GROUP BY u.Sekolah ORDER BY RataRata DESC";

        const schoolRankQuery = await turso.execute({ sql: sqlRank, args: rankArgs });
        output.schoolRanks = schoolRankQuery.rows;

        const mapelsQuery = await turso.execute("SELECT DISTINCT Mapel FROM Exams WHERE Mapel != 'SURVEY'");
        output.uniqueMapels = mapelsQuery.rows.map(r => r.Mapel);
        output.currentMapelFilter = filterMapel || 'ALL';

        if (role === 'admin') {
          const surveys = await turso.execute("SELECT ExamID, Judul, TargetKelas, Token, ShowStats FROM Exams WHERE Mapel = 'SURVEY'");
          output.surveys = surveys.rows;
        }
        if (role === 'guru') {
          const selfData = await turso.execute({ sql: "SELECT StatusApproval, KuotaSiswa FROM Users WHERE ID = ?", args: [userId || ''] });
          output.statusApproval = selfData.rows[0]?.StatusApproval || 'Pending';
          output.kuotaSiswa = selfData.rows[0]?.KuotaSiswa || 0;
        }
      } else if (role === 'siswa') {
        output.availableExams = exams.rows.filter(e => e.Status === 'Aktif');
        const history = await turso.execute({
          sql: "SELECT r.ResultID, r.ExamID, r.WaktuSubmit, r.TotalNilai as Nilai, e.Judul, e.AllowDownloadR, e.AllowDownloadQ, e.ShowStats, r.Pelanggaran FROM Results r JOIN Exams e ON r.ExamID = e.ExamID WHERE r.SiswaID = ? AND e.Mapel != 'SURVEY'",
          args: [userId || '']
        });
        output.history = history.rows;
        const userSelf = await turso.execute({ sql: "SELECT Sesi FROM Users WHERE ID = ?", args: [userId || ''] });
        if (userSelf.rows.length > 0) output.userSesi = userSelf.rows[0].Sesi;
      }
      return jsonResponse({ status: 'success', data: output });
    }

    if (action === 'getAdminData') {
      const [role, , , sekolah] = args;
      const exams = await turso.execute("SELECT * FROM Exams");
      const users = role === 'guru'
        ? await turso.execute({ sql: "SELECT * FROM Users WHERE Role = 'siswa' AND LOWER(TRIM(Sekolah)) = LOWER(TRIM(?))", args: [sekolah || ''] })
        : await turso.execute("SELECT * FROM Users WHERE Role = 'siswa'");
      return jsonResponse({ status: 'success', exams: exams.rows, users: users.rows, logo: 'https://lh3.googleusercontent.com/d/1VJINoN5yi1uc1pRZ5SPrM19gIS2iPhQh' });
    }

    if (action === 'getUserList') {
      const [role, , sekolah] = args;
      const sqlQuery = "SELECT ID, Nama, Username, Password, Role, Sekolah, Kelas, TglLahir, Sesi FROM Users";
      const users = role === 'guru'
        ? await turso.execute({ sql: `${sqlQuery} WHERE Role = 'siswa' AND LOWER(TRIM(Sekolah)) = LOWER(TRIM(?))`, args: [sekolah || ''] })
        : await turso.execute(sqlQuery);
      return jsonResponse({ status: 'success', data: users.rows });
    }

    if (action === 'adminManageUser') {
      const [mode, d] = args;
      if (mode === 'save') {
        const id = d.id || ('U' + Date.now());
        const cek = await turso.execute({ sql: "SELECT ID FROM Users WHERE ID = ?", args: [id] });
        if (cek.rows.length > 0) {
          await turso.execute({
            sql: "UPDATE Users SET Nama=?, Username=?, Password=?, Role=?, Sekolah=?, Kelas=?, TglLahir=?, Foto=COALESCE(NULLIF(?, ''), Foto), Sesi=?, DeviceID='RESET' WHERE ID=?",
            args: [d.nama || '', d.username || '', d.password || '', d.role || '', d.sekolah || '', d.kelas || '', d.tglLahir || '', d.foto || '', d.sesi || '', id]
          });
        } else {
          await turso.execute({
            sql: "INSERT INTO Users (ID, Nama, Username, Password, Role, Sekolah, Kelas, TglLahir, Foto, Sesi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            args: [id, d.nama || '', d.username || '', d.password || '', d.role || '', d.sekolah || '', d.kelas || '', d.tglLahir || '', d.foto || '', d.sesi || '']
          });
        }
      } else if (mode === 'delete') {
        await turso.batch([
          { sql: "DELETE FROM Users WHERE ID = ?", args: [d.id || ''] },
          { sql: "DELETE FROM Payments WHERE GuruID = ?", args: [d.id || ''] }
        ]);
      }
      return jsonResponse({ status: 'success', msg: 'Data User berhasil disimpan!' });
    }

    if (action === 'adminBatchSaveUsers') {
      const usersArr = args[0] || [];
      if (!Array.isArray(usersArr) || usersArr.length === 0) return jsonResponse({ status: 'error', msg: 'Data kosong.' });
      const statements = usersArr.map(d => ({
        sql: "INSERT INTO Users (ID, Nama, Username, Password, Role, Sekolah, Kelas, TglLahir, Foto, Sesi) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '', ?)",
        args: [d.id || ('S-' + Date.now() + Math.random().toString(36).substr(2, 5)), d.nama || '', d.username || '', d.password || '', d.role || 'siswa', d.sekolah || '', d.kelas || '', d.tglLahir || '', d.sesi || '1']
      }));
      await turso.batch(statements);
      return jsonResponse({ status: 'success', count: usersArr.length });
    }

    if (action === 'adminSaveExam') {
      const d = args[0]; const id = d.examId || ('EX' + Date.now());
      const cek = await turso.execute({ sql: "SELECT ExamID FROM Exams WHERE ExamID = ?", args: [id] });
      if (cek.rows.length > 0) {
        await turso.execute({ sql: "UPDATE Exams SET Judul=?, Mapel=?, TargetKelas=?, Durasi=?, Token=?, StartDate=?, EndDate=?, LimitTries=?, ShowStats=?, RandomQ=?, AllowDownloadQ=?, AllowDownloadR=? WHERE ExamID=?", args: [d.judul, d.mapel, d.targetKelas, Number(d.durasi), d.token || '', d.start, d.end, Number(d.limit) || 1, d.showStats, d.randomQ, d.dlSoal, d.dlHasil, id] });
      } else {
        await turso.execute({ sql: "INSERT INTO Exams (ExamID, Judul, Mapel, TargetKelas, Durasi, Token, StartDate, EndDate, LimitTries, ShowStats, RandomQ, AllowDownloadQ, AllowDownloadR, PembuatID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [id, d.judul, d.mapel, d.targetKelas, Number(d.durasi), d.token || '', d.start, d.end, Number(d.limit) || 1, d.showStats, d.randomQ, d.dlSoal, d.dlHasil, d.userId || ''] });
      }
      return jsonResponse({ status: 'success', msg: 'Jadwal Ujian berhasil dibuat!' });
    }

    if (action === 'adminDeleteExam') {
      await turso.execute({ sql: "DELETE FROM Exams WHERE ExamID = ?", args: [args[0] || ''] });
      return jsonResponse({ status: 'success', msg: 'Jadwal/Survey dihapus!' });
    }

    if (action === 'getExamQuestions' || action === 'getSiswaSoal') {
      const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID = ?", args: [args[0] || ''] });
      if (action === 'getSiswaSoal') return jsonResponse({ status: 'success', data: qs.rows });
      return jsonResponse(qs.rows);
    }

    if (action === 'adminSaveSingleQuestion') {
      const [eid, d, userId] = args; const id = d.id || ('Q' + Date.now());
      const cek = await turso.execute({ sql: "SELECT QID FROM Questions WHERE QID = ?", args: [id] });
      if (cek.rows.length > 0) {
        await turso.execute({ sql: "UPDATE Questions SET Tipe=?, Pertanyaan=?, Options=?, Key=?, Skor=?, Nomor=? WHERE QID=?", args: [d.type, d.text, JSON.stringify(d.options), JSON.stringify(d.key), Number(d.score), Number(d.num), id] });
      } else {
        await turso.execute({ sql: "INSERT INTO Questions (QID, ExamID, Tipe, Pertanyaan, Options, Key, Skor, Nomor, PembuatID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", args: [id, eid, d.type, d.text, JSON.stringify(d.options), JSON.stringify(d.key), Number(d.score), Number(d.num), userId || ''] });
      }
      return jsonResponse({ status: 'success', id, msg: 'Soal/Pernyataan tersimpan!' });
    }

    if (action === 'adminDeleteQuestion') {
      await turso.execute({ sql: "DELETE FROM Questions WHERE QID = ?", args: [args[0] || ''] });
      return jsonResponse({ status: 'success', msg: 'Soal dihapus!' });
    }

    if (action === 'adminBatchSaveQuestions') {
      const [eid, qArr, userId] = args;
      const statements = qArr.map(q => ({
        sql: "INSERT INTO Questions (QID, ExamID, Tipe, Pertanyaan, Options, Key, Skor, Nomor, PembuatID) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
        args: ['Q' + Date.now() + Math.floor(Math.random() * 10000), eid, q.type, q.text, JSON.stringify(q.options), JSON.stringify(q.key), Number(q.score), Number(q.num), userId || '']
      }));
      await turso.batch(statements);
      return jsonResponse({ status: 'success', msg: `${qArr.length} soal diupload!` });
    }

    if (action === 'adminSaveSurvey') {
      const d = args[0]; const id = d.id || ('SRV' + Date.now());
      const cek = await turso.execute({ sql: "SELECT ExamID FROM Exams WHERE ExamID = ?", args: [id] });
      if (cek.rows.length > 0) {
        await turso.execute({ sql: "UPDATE Exams SET Judul=?, TargetKelas=?, ShowStats=?, Token=? WHERE ExamID=?", args: [d.judul, d.desc, d.status, d.linkedExam, id] });
      } else {
        await turso.execute({ sql: "INSERT INTO Exams (ExamID, Judul, Mapel, TargetKelas, Durasi, Token, StartDate, EndDate, LimitTries, ShowStats, RandomQ, AllowDownloadQ, AllowDownloadR, PembuatID) VALUES (?, ?, 'SURVEY', ?, 0, ?, '', '', 1, ?, 'No', 'No', 'No', ?)", args: [id, d.judul, d.desc, d.linkedExam, d.status, d.userId || ''] });
      }
      return jsonResponse({ status: 'success', msg: 'Survey ditautkan & disimpan!' });
    }

    if (action === 'checkActiveSurvey') {
      const srv = await turso.execute({ sql: "SELECT * FROM Exams WHERE Mapel='SURVEY' AND Token=? AND ShowStats='Aktif' LIMIT 1", args: [args[0] || ''] });
      if (srv.rows.length > 0) {
        const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID = ?", args: [srv.rows[0].ExamID] });
        return jsonResponse({ status: 'success', data: { header: srv.rows[0], qs: qs.rows } });
      }
      return jsonResponse({ status: 'empty' });
    }

    if (action === 'submitSurveyResponse') {
      const [uid, sid, answers, waktuSubmit] = args;
      const checkDup = await turso.execute({ sql: "SELECT ResultID FROM Results WHERE SiswaID=? AND ExamID=?", args: [uid || '', sid || ''] });
      if (checkDup.rows.length === 0) {
        await turso.execute({
          sql: "INSERT INTO Results (ResultID, SiswaID, ExamID, TotalNilai, Detail, Pelanggaran, WaktuSubmit) VALUES (?, ?, ?, 0, ?, 'Survey Response', ?)",
          args: ['SRES' + Date.now(), uid || '', sid || '', JSON.stringify(answers), waktuSubmit]
        });
      }
      try { await turso.execute({ sql: "UPDATE Users SET Status='Survei Selesai', Terjawab=TotalSoal WHERE ID=?", args: [uid || ''] }); } catch (e) {}
      return jsonResponse({ status: 'success', msg: 'Survey dikirim' });
    }

    if (action === 'getExamPack') {
      const [eid, uid] = args;
      const history = await turso.execute({ sql: "SELECT ResultID FROM Results WHERE ExamID=? AND SiswaID=?", args: [eid || '', uid || ''] });
      if (history.rows.length > 0) return jsonResponse({ status: 'error', msg: 'Ujian sudah dikerjakan.' });

      const now = Date.now();
      if (!cacheStore.examPack[eid] || (now - cacheStore.lastFetchTime > CACHE_TTL)) {
        const examInfo = await turso.execute({ sql: "SELECT * FROM Exams WHERE ExamID=?", args: [eid || ''] });
        const qs = await turso.execute({ sql: "SELECT * FROM Questions WHERE ExamID=?", args: [eid || ''] });
        const cleanQ = qs.rows.map(q => ({ QID: q.QID, Tipe: q.Tipe, Pertanyaan: q.Pertanyaan, Options: q.Options, Nomor: q.Nomor, Extra: [] }));
        cacheStore.examPack[eid] = { data: cleanQ, duration: examInfo.rows[0].Durasi, judul: examInfo.rows[0].Judul, token: examInfo.rows[0].Token };
        cacheStore.lastFetchTime = now;
      }
      const c = cacheStore.examPack[eid];
      return jsonResponse({ status: 'success', data: c.data, duration: c.duration, judul: c.judul, token: c.token });
    }

    if (action === 'submitExam') {
      const [uid, eid, answers, violations, waktuSubmit] = args;
      const checkDup = await turso.execute({ sql: "SELECT ResultID FROM Results WHERE SiswaID=? AND ExamID=?", args: [uid || '', eid || ''] });
      if (checkDup.rows.length > 0) {
        return jsonResponse({ status: 'success', msg: 'Berhasil dikirim (Data disinkronisasi)', data: { score: 0 } });
      }

      const now = Date.now();
      if (!cacheStore.examKeys[eid] || (now - cacheStore.lastFetchTime > CACHE_TTL)) {
        const qRes = await turso.execute({ sql: "SELECT QID, Tipe, Key, Skor, Nomor FROM Questions WHERE ExamID=?", args: [eid || ''] });
        cacheStore.examKeys[eid] = qRes.rows;
      }
      const qsRows = cacheStore.examKeys[eid];

      let rawTotalScore = 0; let detailLog = []; let maxPossibleTotalScore = 0;
      qsRows.forEach(q => { maxPossibleTotalScore += Number(q.Skor) || 0; });

      answers.forEach(ans => {
        const q = qsRows.find(x => x.QID === ans.qid);
        if (q) {
          const keys = JSON.parse(q.Key || "[]");
          let scoreEarned = 0; const maxSkor = Number(q.Skor) || 0;
          if (q.Tipe === 'PGK' && Array.isArray(ans.answer)) {
            const cSel = ans.answer.filter(v => keys.includes(v)).length;
            const wSel = ans.answer.filter(v => !keys.includes(v)).length;
            if (keys.length > 0) scoreEarned = Math.max(0, (cSel - wSel) / keys.length) * maxSkor;
          } else if (q.Tipe === 'PGKK' && Array.isArray(ans.answer)) {
            let match = 0;
            ans.answer.forEach((v, idx) => { if (v && v === keys[idx]) match++; });
            if (keys.length > 0) scoreEarned = (match / keys.length) * maxSkor;
          } else if (q.Tipe === 'PGS') {
            if (keys.includes(ans.answer)) scoreEarned = maxSkor;
          } else {
            if (Array.isArray(ans.answer) ? JSON.stringify(ans.answer) === JSON.stringify(keys) : keys.includes(ans.answer)) scoreEarned = maxSkor;
          }
          scoreEarned = Math.round(scoreEarned * 100) / 100;
          rawTotalScore += scoreEarned;
          detailLog.push({ i: q.Nomor, s: scoreEarned, m: maxSkor, t: q.Tipe, a: ans.answer });
        }
      });

      const finalScore100 = maxPossibleTotalScore > 0 ? Math.round((rawTotalScore / maxPossibleTotalScore) * 10000) / 100 : 0;
      await turso.execute({
        sql: "INSERT INTO Results (ResultID, SiswaID, ExamID, TotalNilai, Detail, Pelanggaran, WaktuSubmit) VALUES (?, ?, ?, ?, ?, ?, ?)",
        args: ['RES' + Date.now(), uid || '', eid || '', finalScore100, JSON.stringify(detailLog), violations > 0 ? `Pelanggaran: ${violations}x` : "-", waktuSubmit]
      });
      try { await turso.execute({ sql: "UPDATE Users SET Status='Selesai Ujian TKA', Terjawab=0 WHERE ID=?", args: [uid || ''] }); } catch (e) {}
      return jsonResponse({ status: 'success', msg: 'Berhasil dikirim', data: { score: finalScore100 } });
    }

    if (action === 'getRecapList') {
      const [role, , sekolah] = args;
      let sql = `SELECT r.ResultID, r.TotalNilai, r.WaktuSubmit, r.SiswaID, r.ExamID, r.Pelanggaran, COALESCE(u.Nama, 'Akun Telah Dihapus') AS NamaSiswa, COALESCE(u.Kelas, '-') AS KelasSiswa, COALESCE(u.Sekolah, '-') AS SekolahSiswa, e.Judul AS JudulUjian, e.Mapel AS Mapel, e.PembuatID AS PembuatID, e.ShowStats AS ShowStats, (SELECT Nama FROM Users WHERE ID = e.PembuatID) AS PembuatNama FROM Results r LEFT JOIN Users u ON r.SiswaID = u.ID LEFT JOIN Exams e ON r.ExamID = e.ExamID WHERE 1=1`;
      let pArgs = [];
      if (role === 'guru') { sql += ` AND LOWER(TRIM(u.Sekolah)) = LOWER(TRIM(?))`; pArgs.push(sekolah || ''); }
      const results = await turso.execute({ sql, args: pArgs });
      const modifiedRows = results.rows.map(row => ({ ...row, Detail: row.Mapel === 'SURVEY' ? '[{"responses":[]}]' : '[]' }));
      return jsonResponse({ status: 'success', data: modifiedRows });
    }

    if (action === 'getSiswaDetailHasil') {
      const results = await turso.execute({
        sql: `SELECT r.TotalNilai, r.Detail, e.Judul, e.Mapel, u.Nama as NamaSiswa FROM Results r JOIN Exams e ON r.ExamID = e.ExamID LEFT JOIN Users u ON r.SiswaID = u.ID WHERE r.ResultID = ?`,
        args: [args[0] || '']
      });
      return jsonResponse({ status: 'success', data: results.rows[0] });
    }

    if (action === 'adminUpdateResult') {
      await turso.execute({ sql: "UPDATE Results SET TotalNilai=?, Detail=? WHERE ResultID=?", args: [args[1], args[2], args[0] || ''] });
      return jsonResponse({ status: 'success', msg: 'Nilai dan Koreksi diperbarui.' });
    }

    if (action === 'adminDeleteResult') {
      await turso.execute({ sql: "DELETE FROM Results WHERE ResultID=?", args: [args[0] || ''] });
      return jsonResponse({ status: 'success', msg: 'Hasil Dihapus!' });
    }

    return jsonResponse({ status: 'success', data: [] });
  } catch (error) {
    return jsonResponse({ status: 'error', msg: error.message }, 500);
  }
}
