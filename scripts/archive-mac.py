"""Archive a signed .app without dropping executable bits or framework symlinks."""
from pathlib import Path
import os, stat, sys, zipfile
source=Path(sys.argv[1]);target=Path(sys.argv[2])
with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=6) as archive:
    for path in [source,*sorted(source.rglob('*'))]:
        relative=source.name+'/'+path.relative_to(source).as_posix()
        if path==source: relative=source.name
        info=zipfile.ZipInfo(relative+('/' if path.is_dir() and not path.is_symlink() else ''))
        info.create_system=3;info.external_attr=path.lstat().st_mode<<16
        if path.is_symlink(): archive.writestr(info,os.readlink(path).encode())
        elif path.is_file():
            info.compress_type=zipfile.ZIP_DEFLATED
            with path.open('rb') as reader,archive.open(info,'w') as writer:
                import shutil
                shutil.copyfileobj(reader,writer,1024*1024)
        else: archive.writestr(info,b'')
print(target)
