import fs from 'fs';
import path from 'path';

const distPath = path.join(process.cwd(), 'dist');
const indexPath = path.join(distPath, 'index.html');

if (fs.existsSync(indexPath)) {
  let html = fs.readFileSync(indexPath, 'utf-8');
  
  // 只将script标签从head移到body末尾，CSS link保留在head中
  const scriptMatch = html.match(/<script[^>]*type="module"[^>]*crossorigin[^>]*src="([^"]*)"[^>]*><\/script>/);
  
  if (scriptMatch) {
    // 移除head中的script标签
    html = html.replace(/<script[^>]*type="module"[^>]*crossorigin[^>]*src="([^"]*)"[^>]*><\/script>\n?/, '');
    
    // 在body末尾添加script标签
    const scriptTag = `<script type="module" crossorigin src="${scriptMatch[1]}"></script>`;
    
    html = html.replace('</body>', `    ${scriptTag}\n  </body>`);
    
    fs.writeFileSync(indexPath, html);
    console.log('✅ 已优化 index.html：script标签移到body末尾');
  }
}
