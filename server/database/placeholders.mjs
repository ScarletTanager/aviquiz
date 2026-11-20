// Portable application queries use ? parameters. Values are always bound separately.
// Preserve quoted text, identifiers, dollar strings and nested SQL comments.
export function postgresQuery(sql,values) {
  let text='',count=0,i=0;
  while(i<sql.length) {
    if(sql[i]==="'"||sql[i]==='"') {
      const quote=sql[i];text+=sql[i++];
      while(i<sql.length) {
        const ch=sql[i++];text+=ch;
        if(ch===quote){if(sql[i]===quote)text+=sql[i++];else break;}
      }
    } else if(sql.startsWith('--',i)) {
      const end=sql.indexOf('\n',i);const next=end<0?sql.length:end;
      text+=sql.slice(i,next);i=next;
    } else if(sql.startsWith('/*',i)) {
      let depth=1;text+='/*';i+=2;
      while(i<sql.length&&depth) {
        if(sql.startsWith('/*',i)){depth++;text+='/*';i+=2;}
        else if(sql.startsWith('*/',i)){depth--;text+='*/';i+=2;}
        else text+=sql[i++];
      }
    } else if(sql[i]==='$'&&/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.test(sql.slice(i))) {
      const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/)[0];
      const end=sql.indexOf(tag,i+tag.length);
      if(end<0)throw Error('Unterminated SQL dollar string.');
      text+=sql.slice(i,end+tag.length);i=end+tag.length;
    } else if(sql[i]==='?') {text+='$'+(++count);i++;}
    else text+=sql[i++];
  }
  if(count!==values.length||values.some(v=>v===undefined))throw Error('Invalid SQL parameter count or value.');
  return {text,values};
}
