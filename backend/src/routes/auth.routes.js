module.exports = function registerAuthUserRoutes(ctx) {
  const {
    app,
    SIGNUP_CODE_TTL_MIN,
    pool,
    nowIso,
    hashPassword,
    verifyPassword,
    isUsableEmail,
    isStrongPassword,
    normalizeUserSettings,
    generateVerificationCode,
    hashVerificationCode,
    sendVerificationEmail,
    toPublicUser,
    normalizeUserProfilePayload,
    getEffectiveMembership,
    supabasePasswordSignIn,
    supabaseGetUser,
    supabaseAdminCreateUser,
    supabaseAdminDeleteUser,
    supabaseUserUpdate,
    supabaseSendSignupOtp,
    supabaseVerifyEmailOtp,
    ensureUserProfile,
    getUserProfileById,
    getSupabaseAuthUserByEmail,
    pickProfileName,
    requireAuth
  } = ctx;

  async function issueSignupCode({ name, email, password }) {
    if (!name || !email || !password) {
      return { status: 400, body: { error: 'name/email/password are required' } };
    }
    if (!isUsableEmail(email)) {
      return { status: 400, body: { error: 'Please enter a valid usable email address (for future email notifications)' } };
    }
    if (!isStrongPassword(password)) {
      return { status: 400, body: { error: 'Password must be at least 6 chars and include uppercase, lowercase and number' } };
    }

    const existingAuthUser = await getSupabaseAuthUserByEmail(email);

    if (existingAuthUser) {
      const existingProfile = await getUserProfileById(existingAuthUser.id);

      if (existingProfile) {
        return { status: 409, body: { error: 'Email is already registered' } };
      }
    }

    const passwordHash = hashPassword(password);
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + SIGNUP_CODE_TTL_MIN * 60 * 1000).toISOString();

    await pool.query(
      `
    INSERT INTO signup_verifications (email, name, password_hash, code_hash, expires_at, attempts, last_sent_at, created_at)
    VALUES ($1, $2, $3, '', $4, 0, $5, $6)
    ON CONFLICT(email) DO UPDATE SET
      name = EXCLUDED.name,
      password_hash = EXCLUDED.password_hash,
      code_hash = '',
      expires_at = EXCLUDED.expires_at,
      attempts = 0,
      last_sent_at = EXCLUDED.last_sent_at
    `,
      [email, name, passwordHash, expiresAt, createdAt, createdAt]
    );

    await supabaseSendSignupOtp(email, name);

    return {
      status: 200,
      body: {
        ok: true,
        message: 'Verification code sent, please check your email'
      }
    };
  }



  app.post('/api/auth/signup/request-code', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    try {
      const result = await issueSignupCode({ name, email, password });
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error('Failed to send verification code:', error.message);
      res.status(500).json({ error: 'Failed to send verification code' });
    }
  });

  app.post('/api/auth/signup/verify-code', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const code = String(req.body?.code || '').trim();
    if (!email || !code) {
      return res.status(400).json({ error: 'email/code are required' });
    }
    if (!/^\d{6,8}$/.test(code)) {
      return res.status(400).json({ error: 'Invalid verification code format, it must be 6 digits' });
    }
    try {
      // const existingUser = await getSupabaseAuthUserByEmail(email);
      // if (existingUser) return res.status(409).json({ error: 'Email already registered, delete the account before reusing this email for testing' });

      const verResult = await pool.query(
        `
      SELECT email, name, password_hash, code_hash, expires_at, attempts
      FROM signup_verifications
      WHERE email = $1
      `,
        [email]
      );
      const ver = verResult.rows[0];
      if (!ver) return res.status(400).json({ error: 'Please request a verification code first' });
      if (new Date(ver.expires_at).getTime() < Date.now()) {
        return res.status(400).json({ error: 'Verification code expired, please resend' });
      }
      if (ver.attempts >= 8) {
        return res.status(429).json({ error: 'Too many code attempts, please resend' });
      }
      let verified;
      try {
        verified = await supabaseVerifyEmailOtp(email, code);
      } catch (otpError) {
        await pool.query(`UPDATE signup_verifications SET attempts = attempts + 1 WHERE email = $1`, [email]);
        return res.status(400).json({ error: 'Verification code is incorrect or expired' });
      }

      const password = req.body?.password ? String(req.body.password || '').trim() : null;
      let plainPassword = password;
      if (!plainPassword || !verifyPassword(plainPassword, ver.password_hash)) {
        return res.status(400).json({ error: 'Original password is required to complete signup in the new auth system' });
      }

      await supabaseUserUpdate(verified.access_token, {
        password: plainPassword,
        data: {
          name: ver.name,
          role: 'user'
        }
      });

      const authUser = verified.user || await supabaseGetUser(verified.access_token);
      const profile = await ensureUserProfile(authUser.id, email, ver.name, 'user');

      await pool.query(`DELETE FROM signup_verifications WHERE email = $1`, [email]);

      res.json({
        token: verified.access_token,
        user: toPublicUser(profile)
      });
    } catch (error) {
      console.error('Verification signup failed:', error.message);
      res.status(500).json({ error: 'Verification signup failed' });
    }
  });

  app.post('/api/auth/signup', async (req, res) => {
    res.status(410).json({ error: 'Please use /api/auth/signup/request-code and /api/auth/signup/verify-code to complete signup' });
  });

  app.post('/api/auth/signup/resend-code', async (req, res) => {
    const name = String(req.body?.name || '').trim();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    try {
      const result = await issueSignupCode({ name, email, password });
      res.status(result.status).json(result.body);
    } catch (error) {
      console.error('Failed to resend verification code:', error.message);
      res.status(500).json({ error: 'Failed to resend verification code' });
    }
  });

  app.delete('/api/auth/account', requireAuth, async (req, res) => {
    const password = String(req.body?.password || '').trim();
    if (!password) return res.status(400).json({ error: 'Enter current password to confirm account deletion' });
    try {
      await supabasePasswordSignIn(req.session.user.email, password);
      await supabaseAdminDeleteUser(req.session.user.id);
      await pool.query(`DELETE FROM app_user_profiles WHERE user_id = $1`, [req.session.user.id]);
      res.json({ ok: true, message: 'Account deleted.' });
    } catch (error) {
      console.error('Failed to delete account:', error.message);
      res.status(500).json({ error: 'Failed to delete account' });
    }
  });

  app.get('/api/user/settings', requireAuth, async (req, res) => {
    try {
      const user = await getUserProfileById(req.session.user.id);
      if (!user) return res.status(404).json({ error: 'User does not exist' });
      const settingsQ = await pool.query(
        `
      SELECT company_location, home_location, frequent_places, commute_to_work_time, commute_to_home_time, frequent_routes, vehicles
      FROM app_user_settings
      WHERE user_id = $1
      `,
        [user.id]
      );
      const row = settingsQ.rows[0];
      const frequentPlaces = Array.isArray(row?.frequent_places) && row.frequent_places.length
        ? row.frequent_places.slice(0, 4)
        : [
          row?.company_location ? { name: 'Company', query: row.company_location } : null,
          row?.home_location ? { name: 'Home', query: row.home_location } : null
        ].filter(Boolean);
      const settings = row ? {
        companyLocation: row.company_location || '',
        homeLocation: row.home_location || '',
        frequentPlaces,
        commuteToWorkTime: row.commute_to_work_time || '',
        commuteToHomeTime: row.commute_to_home_time || '',
        frequentRoutes: Array.isArray(row.frequent_routes) ? row.frequent_routes.slice(0, 3) : [],
        vehicles: Array.isArray(row.vehicles) ? row.vehicles.slice(0, 3) : []
      } : {
        companyLocation: '',
        homeLocation: '',
        frequentPlaces: [],
        commuteToWorkTime: '',
        commuteToHomeTime: '',
        frequentRoutes: [],
        vehicles: []
      };
      res.json({ user: toPublicUser(user), settings });
    } catch (error) {
      console.error('Failed to load user settings:', error.message);
      res.status(500).json({ error: 'Failed to load user settings' });
    }
  });

  app.get('/api/user/profile', requireAuth, async (req, res) => {
    try {
      const user = await getUserProfileById(req.session.user.id);
      if (!user) return res.status(404).json({ error: 'User does not exist' });
      const profile = {
        memberTier: getEffectiveMembership(user).tier,
        memberExpiresAt: getEffectiveMembership(user).expiresAt,
        bio: user.bio || '',
        gender: user.gender || '',
        birthday: user.birthday ? new Date(user.birthday).toISOString().slice(0, 10) : '',
        region: user.region || '',
        profession: user.profession || '',
        school: user.school || ''
      };
      res.json({ user: toPublicUser(user), profile });
    } catch (error) {
      console.error('Failed to load user profile:', error.message);
      res.status(500).json({ error: 'Failed to load user profile' });
    }
  });

  app.put('/api/user/profile', requireAuth, async (req, res) => {
    try {
      const profile = normalizeUserProfilePayload(req.body || {});
      const updated = await pool.query(
        `
      UPDATE app_user_profiles
      SET
        bio = $2,
        gender = $3,
        birthday = NULLIF($4, '')::date,
        region = $5,
        profession = $6,
        school = $7,
        updated_at = $8
      WHERE user_id = $1
      RETURNING
        user_id AS id,
        email,
        name,
        role,
        member_tier,
        member_expires_at,
        bio,
        gender,
        birthday,
        region,
        profession,
        school
      `,
        [
          req.session.user.id,
          profile.bio,
          profile.gender,
          profile.birthday,
          profile.region,
          profile.profession,
          profile.school,
          nowIso()
        ]
      );
      if (!updated.rows[0]) return res.status(404).json({ error: 'User does not exist' });
      res.json({
        ok: true,
        user: toPublicUser(updated.rows[0]),
        profile: {
          memberTier: getEffectiveMembership(updated.rows[0]).tier,
          memberExpiresAt: getEffectiveMembership(updated.rows[0]).expiresAt,
          bio: updated.rows[0].bio || '',
          gender: updated.rows[0].gender || '',
          birthday: updated.rows[0].birthday ? new Date(updated.rows[0].birthday).toISOString().slice(0, 10) : '',
          region: updated.rows[0].region || '',
          profession: updated.rows[0].profession || '',
          school: updated.rows[0].school || ''
        }
      });
    } catch (error) {
      console.error('Failed to save user profile:', error.message);
      res.status(500).json({ error: 'Failed to save user profile' });
    }
  });

  app.post('/api/user/membership/upgrade', requireAuth, async (req, res) => {
    if (req.session.user.role === 'admin') {
      return res.status(400).json({ error: 'Admin account does not use public membership plans' });
    }
    try {
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
      const updated = await pool.query(
        `
      UPDATE app_user_profiles
      SET
        member_tier = 'advanced',
        member_expires_at = $2,
        updated_at = $3
      WHERE user_id = $1
      RETURNING
        user_id AS id,
        email,
        name,
        role,
        member_tier,
        member_expires_at
      `,
        [req.session.user.id, expiresAt, nowIso()]
      );
      if (!updated.rows[0]) return res.status(404).json({ error: 'User does not exist' });
      res.json({
        ok: true,
        user: toPublicUser(updated.rows[0]),
        membership: getEffectiveMembership(updated.rows[0])
      });
    } catch (error) {
      console.error('Failed to upgrade membership:', error.message);
      res.status(500).json({ error: 'Failed to upgrade membership' });
    }
  });

  app.put('/api/user/settings', requireAuth, async (req, res) => {
    try {
      const settings = normalizeUserSettings(req.body || {});
      await pool.query(
        `
      INSERT INTO app_user_settings (
        user_id, company_location, home_location, frequent_places, commute_to_work_time, commute_to_home_time, frequent_routes, vehicles, updated_at
      )
      VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7::jsonb, $8::jsonb, $9)
      ON CONFLICT(user_id) DO UPDATE SET
        company_location = EXCLUDED.company_location,
        home_location = EXCLUDED.home_location,
        frequent_places = EXCLUDED.frequent_places,
        commute_to_work_time = EXCLUDED.commute_to_work_time,
        commute_to_home_time = EXCLUDED.commute_to_home_time,
        frequent_routes = EXCLUDED.frequent_routes,
        vehicles = EXCLUDED.vehicles,
        updated_at = EXCLUDED.updated_at
      `,
        [
          req.session.user.id,
          settings.frequentPlaces[0]?.query || '',
          settings.frequentPlaces[1]?.query || '',
          JSON.stringify(settings.frequentPlaces),
          settings.commuteToWorkTime,
          settings.commuteToHomeTime,
          JSON.stringify(settings.frequentRoutes),
          JSON.stringify(settings.vehicles),
          nowIso()
        ]
      );
      await pool.query(`DELETE FROM saved_places WHERE user_id = $1 AND label LIKE 'PLACE_%'`, [req.session.user.id]);
      const syncPlaces = async (label, placeName) => {
        const value = String(placeName || '').trim();
        await pool.query(`DELETE FROM saved_places WHERE user_id = $1 AND label = $2`, [req.session.user.id, label]);
        if (!value) {
          return;
        }
        await pool.query(
          `
        INSERT INTO saved_places (user_id, place_name, label, lat, lon, created_at)
        VALUES ($1, $2, $3, NULL, NULL, $4)
        `,
          [req.session.user.id, value, label, nowIso()]
        );
      };
      for (let i = 0; i < settings.frequentPlaces.length; i += 1) {
        const place = settings.frequentPlaces[i];
        await syncPlaces(`PLACE_${i + 1}`, place.query);
      }
      res.json({ ok: true, settings });
    } catch (error) {
      console.error('Failed to save user settings:', error.message);
      res.status(500).json({ error: 'Failed to save user settings' });
    }
  });

  app.put('/api/user/settings/vehicles', requireAuth, async (req, res) => {
    try {
      const settings = normalizeUserSettings({ vehicles: req.body?.vehicles });
      await pool.query(
        `
      INSERT INTO app_user_settings (
        user_id, vehicles, updated_at
      )
      VALUES ($1, $2::jsonb, $3)
      ON CONFLICT(user_id) DO UPDATE SET
        vehicles = EXCLUDED.vehicles,
        updated_at = EXCLUDED.updated_at
      `,
        [
          req.session.user.id,
          JSON.stringify(settings.vehicles),
          nowIso()
        ]
      );
      res.json({ ok: true, vehicles: settings.vehicles });
    } catch (error) {
      console.error('Failed to save vehicles:', error.message);
      res.status(500).json({ error: 'Failed to save vehicles' });
    }
  });


  app.put('/api/user/name', requireAuth, async (req, res) => {
    const name = String(req.body?.name || '').trim();
    if (!name) return res.status(400).json({ error: 'Please enter a name' });
    if (name.length > 80) return res.status(400).json({ error: 'Name is too long (max 80 chars)' });
    try {
      const updated = await pool.query(
        `
      UPDATE app_user_profiles
      SET name = $1, updated_at = $3
      WHERE user_id = $2
      RETURNING user_id AS id, name, email, role, member_tier, member_expires_at
      `,
        [name, req.session.user.id, nowIso()]
      );
      if (!updated.rows[0]) return res.status(404).json({ error: 'User does not exist' });
      await supabaseUserUpdate(req.session.token, { data: { name } });
      res.json({ ok: true, user: toPublicUser(updated.rows[0]) });
    } catch (error) {
      console.error('Failed to update name:', error.message);
      res.status(500).json({ error: 'Failed to update name' });
    }
  });

  app.put('/api/user/password', requireAuth, async (req, res) => {
    const currentPassword = String(req.body?.currentPassword || '').trim();
    const newPassword = String(req.body?.newPassword || '').trim();
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: 'Please enter current and new password' });
    }
    if (!isStrongPassword(newPassword)) {
      return res.status(400).json({ error: 'New password must be at least 6 chars and include uppercase, lowercase and number' });
    }
    try {
      await supabasePasswordSignIn(req.session.user.email, currentPassword);
      await supabaseUserUpdate(req.session.token, { password: newPassword });
      res.json({ ok: true });
    } catch (error) {
      console.error('Failed to change password:', error.message);
      res.status(500).json({ error: 'Failed to change password' });
    }
  });

  app.post('/api/auth/login', async (req, res) => {
    const email = String(req.body?.email || '').trim().toLowerCase();
    const password = String(req.body?.password || '').trim();
    if (!email || !password) return res.status(400).json({ error: 'email/password are required' });
    try {
      const signedIn = await supabasePasswordSignIn(email, password);
      const authUser = signedIn.user || await supabaseGetUser(signedIn.access_token);
      let profile = await getUserProfileById(authUser.id);
      if (!profile) {
        const role = String(authUser?.user_metadata?.role || '').trim().toLowerCase() === 'admin' ? 'admin' : (email === 'admin@fast.local' ? 'admin' : 'user');
        profile = await ensureUserProfile(authUser.id, authUser.email, pickProfileName(authUser, authUser.email), role);
      }
      res.json({
        token: signedIn.access_token,
        refreshToken: signedIn.refresh_token,
        expiresIn: signedIn.expires_in,
        user: toPublicUser(profile)
      });
    } catch (error) {
      console.error('Login failed:', error.message);
      res.status(500).json({ error: 'Login failed' });
    }
  });

  app.get('/api/auth/me', requireAuth, (req, res) => {
    res.json({ user: req.session.user });
  });

  app.post('/api/auth/logout', requireAuth, async (req, res) => {
    res.json({ ok: true });
  });
};
