export default async function handler(req, res) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Content-Type': 'application/json'
  };

  if (req.method === 'OPTIONS') {
    return res.status(200).setHeaders(headers).end();
  }

  try {
    const { action, token, repo, files, message, vercelToken, projectName } = req.body || {};

    if (action === 'github-create') {
      if (!token || !repo) {
        return res.status(400).setHeaders(headers).json({ error: 'Token y nombre del repo requeridos' });
      }

      const [owner, repoName] = repo.includes('/') ? repo.split('/') : [null, repo];

      const createResp = await fetch('https://api.github.com/user/repos', {
        method: 'POST',
        headers: {
          'Authorization': `token ${token}`,
          'Content-Type': 'application/json',
          'Accept': 'application/vnd.github.v3+json'
        },
        body: JSON.stringify({
          name: repoName,
          description: 'PWA Player generado con PWA Player Generator',
          private: false,
          auto_init: true
        })
      });

      if (!createResp.ok && createResp.status !== 422) {
        const err = await createResp.json();
        return res.status(createResp.status).setHeaders(headers).json({ error: err.message || 'Error creando repo' });
      }

      const ownerName = owner || (await (await fetch('https://api.github.com/user', {
        headers: { 'Authorization': `token ${token}` }
      })).json()).login;

      if (files && Array.isArray(files)) {
        const repoFullName = `${ownerName}/${repoName}`;

        const getSha = async (path) => {
          try {
            const r = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${path}`, {
              headers: { 'Authorization': `token ${token}`, 'Accept': 'application/vnd.github.v3+json' }
            });
            if (r.ok) {
              const d = await r.json();
              return d.sha;
            }
          } catch (e) {}
          return null;
        };

        const existingReadmeSha = await getSha('README.md');

        for (const file of files) {
          const sha = file.path === 'README.md' ? existingReadmeSha : await getSha(file.path);
          const commitResp = await fetch(`https://api.github.com/repos/${repoFullName}/contents/${file.path}`, {
            method: 'PUT',
            headers: {
              'Authorization': `token ${token}`,
              'Content-Type': 'application/json',
              'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify({
              message: message || `Add ${file.path}`,
              content: file.content,
              sha: sha || undefined
            })
          });

          if (!commitResp.ok) {
            const err = await commitResp.json();
            console.error(`Error subiendo ${file.path}:`, err);
          }
        }
      }

      return res.status(200).setHeaders(headers).json({
        success: true,
        url: `https://github.com/${ownerName}/${repoName}`,
        cloneUrl: `https://github.com/${ownerName}/${repoName}.git`
      });
    }

    if (action === 'vercel-deploy') {
      if (!vercelToken) {
        return res.status(400).setHeaders(headers).json({ error: 'Token de Vercel requerido' });
      }

      const vercelHeaders = {
        'Authorization': `Bearer ${vercelToken}`,
        'Content-Type': 'application/json'
      };

      if (!projectName) {
        return res.status(400).setHeaders(headers).json({ error: 'Nombre del proyecto requerido' });
      }

      const projectResp = await fetch('https://api.vercel.com/v9/projects', {
        method: 'POST',
        headers: vercelHeaders,
        body: JSON.stringify({
          name: projectName,
          framework: null,
          gitRepository: req.body.gitRepo ? { repo: req.body.gitRepo, type: 'github' } : undefined
        })
      });

      const projectData = await projectResp.json();

      if (req.body.files && req.body.deploy) {
        const deployResp = await fetch('https://api.vercel.com/v13/deployments', {
          method: 'POST',
          headers: vercelHeaders,
          body: JSON.stringify({
            name: projectName,
            files: req.body.files,
            projectSettings: { framework: null },
            target: 'production'
          })
        });

        const deployData = await deployResp.json();

        return res.status(200).setHeaders(headers).json({
          success: true,
          projectId: projectData.id || projectData.name,
          deployUrl: deployData.url ? `https://${deployData.url}` : null,
          projectUrl: `https://vercel.com/${deployData.owner?.username || 'dashboard'}/${projectName}`
        });
      }

      return res.status(200).setHeaders(headers).json({
        success: true,
        projectId: projectData.id || projectData.name,
        message: 'Proyecto creado. Conecta tu repositorio de GitHub para despliegue automático.'
      });
    }

    return res.status(400).setHeaders(headers).json({ error: 'Acción no válida. Usa: github-create o vercel-deploy' });

  } catch (error) {
    console.error('API Error:', error);
    return res.status(500).setHeaders(headers).json({ error: error.message || 'Error interno del servidor' });
  }
}
