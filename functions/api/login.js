import { createTursoClient, signToken, jsonResponse } from '../_turso.js';

export async function onRequestPost(context) {
  try {
    const { request, env } = context;
    const turso = createTursoClient(env);
    const { username, password, tglLahir } = await request.json();

    const result = await turso.execute({
      sql: "SELECT ID, Nama, Username, Role, Sekolah, Kelas, TglLahir, Sesi, StatusApproval, KuotaSiswa, NoHP FROM Users WHERE Username = ? AND CAST(Password AS TEXT) = ?",
      args: [username || '', password || '']
    });

    if (result.rows.length > 0) {
      const user = result.rows[0];
      const role = String(user.Role || '').trim().toLowerCase();

      if (role === 'siswa') {
        const dbTgl = String(user.TglLahir || '').trim();
        const inputTgl = String(tglLahir || '').trim();
        if (dbTgl !== inputTgl) {
          return jsonResponse({ status: 'error', msg: 'Tanggal Lahir salah untuk akun Anda!' });
        }
      }

      const token = await signToken(
        { id: user.ID, role: user.Role },
        env.JWT_SECRET || 'rahasia_super_aman_cbt_123'
      );

      return jsonResponse({
        status: 'success',
        data: user,
        token: token,
        logo: 'https://lh3.googleusercontent.com/d/1VJINoN5yi1uc1pRZ5SPrM19gIS2iPhQh'
      });
    }

    return jsonResponse({ status: 'error', msg: 'Username atau Password salah!' });
  } catch (error) {
    return jsonResponse({ status: 'error', msg: error.message }, 500);
  }
}
