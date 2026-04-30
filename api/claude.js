// Vercel Serverless Function — proxy vers l'API Anthropic
// Syntaxe CommonJS pour compatibilité maximale Vercel
// Lit ANTHROPIC_API_KEY depuis Environment Variables
// POST /api/claude { brief, placements } → { argumentaire }

module.exports = async function handler(req, res) {
  // CORS / preflight
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed, use POST' });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({
      error: 'ANTHROPIC_API_KEY non configurée. Vercel → Settings → Environment Variables → ajoute la clé puis redéploie.',
    });
  }

  try {
    // Vercel parse le JSON automatiquement si Content-Type: application/json
    let body = req.body;
    if (typeof body === 'string') {
      try { body = JSON.parse(body); } catch (e) { body = {}; }
    }
    if (!body) body = {};
    const brief = body.brief || {};
    const placements = body.placements || [];

    if (!placements.length) {
      return res.status(400).json({ error: 'Aucun emplacement fourni dans la requête.' });
    }

    const systemPrompt = `Tu es un commercial chez Métropole, régie publicitaire OOH/DOOH parisienne. Tu écris l'argumentaire d'une recommandation commerciale dans un mail au client.

STYLE OBLIGATOIRE :
- Tutoiement, ton direct et chaleureux (le client est quelqu'un avec qui tu t'entends bien)
- INTERDIT : tirets cadratins, tirets demi-cadratins, formules pompeuses, jargon IA
- INTERDIT : "il convient de", "particulièrement pertinent", "remarquable", "exceptionnel", "stratégique"
- 3 à 5 phrases maximum, claires et concrètes
- Tu apportes une vraie justification basée sur les datas et le brief, pas une paraphrase
- Tu peux citer des chiffres précis (audience, profil démographique, surface, m²)
- Tu mentionnes la localisation et les quartiers parisiens si pertinent
- Pour les emplacements périphérique/A1 : tu insistes sur l'audience automobiliste
- Pour les toiles patrimoine/Saint-Honoré/Saint-Georges : tu insistes sur l'image de marque et le quartier
- Pour Printemps Haussmann : tu insistes sur le shopping premium et l'audience CSP+
- Pour Citadium : tu insistes sur le streetwear/sneakers et la cible 15-34

FORMAT : un seul paragraphe, sans titre, sans liste, sans bullet points, sans saut de ligne. Du texte fluide.`;

    const briefSummary = [
      `Annonceur : ${brief.brand || '—'}`,
      `Secteur : ${brief.sector || '—'}`,
      `Objectif : ${brief.objective || '—'}`,
      `Période : S${brief.weekStart || '?'} à S${brief.weekEnd || '?'} 2026`,
      `Durée campagne : ${brief.duration || '—'} jours`,
      `Zone(s) : ${(brief.zones || []).join(', ')}`,
      brief.budget ? `Budget cible : ${brief.budget} € brut` : null,
      brief.exclusions ? `Exclusions : ${brief.exclusions}` : null,
    ].filter(Boolean).join('\n');

    const placementsSummary = placements.map(function (p, i) {
      const lines = [(i + 1) + '. ' + p.full_name];
      lines.push('   Type : ' + (p.type || '—') + ' / ' + (p.subtype || '—') + ' (' + (p.city || '—') + ', ' + (p.zone || '—') + ')');
      if (p.surface_m2) lines.push('   Surface : ' + p.surface_m2 + ' m²');
      if (p.context) lines.push('   Contexte : ' + p.context);
      if (p.estimated_odv) lines.push('   ODV estimée campagne : ' + p.estimated_odv + ' contacts');
      if (p.demographics) {
        const d = p.demographics;
        const parts = [];
        if (d.sexe) parts.push('H ' + d.sexe.H + '% / F ' + d.sexe.F + '%');
        if (d.top_age) parts.push('top ' + d.top_age[0] + ' ans (' + d.top_age[1] + '%)');
        if (d.top_csp) parts.push(d.top_csp[0] + ' ' + d.top_csp[1] + '%');
        if (d.top_mobi) parts.push(d.top_mobi[0] + ' ' + d.top_mobi[1] + '%');
        if (parts.length) lines.push('   Profil : ' + parts.join(' · '));
      }
      return lines.join('\n');
    }).join('\n\n');

    const userPrompt = 'BRIEF CLIENT (rempli par le commercial dans l\'outil) :\n' + briefSummary + '\n\n' +
      (brief.contexte ? 'CONTEXTE / TEXTE DU BRIEF REÇU :\n' + brief.contexte + '\n\n' : '') +
      'EMPLACEMENTS RECOMMANDÉS (top reco du scénario 1) :\n' + placementsSummary + '\n\n' +
      'Génère un paragraphe d\'argumentaire commercial pour le mail à ' + (brief.brand || 'ce client') + '. Justifie pourquoi ces emplacements sont les bons en t\'appuyant sur les datas (audience, profil, localisation) et sur le contexte du brief. Style décontracté, tutoiement, sans tirets cadratins.';

    const anthropicResp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-6',
        max_tokens: 700,
        system: systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await anthropicResp.json();

    if (!anthropicResp.ok) {
      console.error('Anthropic API error:', data);
      return res.status(anthropicResp.status).json({
        error: (data.error && data.error.message) || 'Erreur API Anthropic',
        details: data,
      });
    }

    const text = (data.content && data.content[0] && data.content[0].text) || '';
    return res.status(200).json({
      argumentaire: text.trim(),
      usage: data.usage,
      model: data.model,
    });
  } catch (err) {
    console.error('Handler error:', err);
    return res.status(500).json({ error: err.message || 'Erreur serveur' });
  }
};
