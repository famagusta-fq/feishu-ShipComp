import fs from 'fs';
import path from 'path';

const distPath = path.join(process.cwd(), 'dist');
const indexPath = path.join(distPath, 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf-8');
  
  // 将script标签从head移到body末尾
  const scriptMatch = html.match(/<script[^>]*type="module"[^>]*crossorigin[^>]*src="([^"]*)"[^>]*><\/script>/);
  const cssMatch = html.match(/<link[^>]*rel="stylesheet"[^>]*crossorigin[^>]*href="([^"]*)"[^>]*>/);
  
  if (scriptMatch || cssMatch) {
    // 移除head中的script和link标签
    html = html.replace(/<script[^>]*type="module"[^>]*crossorigin[^>]*src="([^"]*)"[^>]*><\/script>\n?/, '');
    html = html.replace(/<link[^>]*rel="stylesheet"[^>]*crossorigin[^>]*href="([^"]*)"[^>]*>\n?/, '');
    
    // 在body末尾添加link和script标签
    const insertCode = `${cssMatch ? `<link rel="stylesheet" crossorigin href="${cssMatch[1]}">\n    ` : ''}${scriptMatch ? `<script type="module" crossorigin src="${scriptMatch[1]}"></script>` : ''}`;
    
    html = html.replace('</body>', `    ${insertCode}\n  </body>`);
    
    fs.writeFileSync(indexPath, html);
    console.log('✅ 已优化 index.html：script标签移到body末尾');
  }
}
