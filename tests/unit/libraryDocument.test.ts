import {it,expect} from 'vitest';
import {documentInfo,documentName} from '../../src/lib/office/library-document';
it('uses actual titles/headings without guessing from paths, and keeps binary unsupported',()=>{
 expect(documentInfo('index.html','<title>Index</title><h1>A &amp; B</h1>')).toEqual({previewKind:'html',title:'A & B'});
 expect(documentName('index.html','<title>Actual / report</title>')).toBe('Actual report.html');
 expect(documentInfo('coins/index.html','<body>No title</body>')).toEqual({previewKind:'html'});
 expect(documentInfo('file.pdf','Title')).toEqual({});expect(documentInfo('file.txt','a\0b')).toEqual({});
 expect(documentName('index.md','# Actual heading\nBody')).toBe('Actual heading.md');
});
