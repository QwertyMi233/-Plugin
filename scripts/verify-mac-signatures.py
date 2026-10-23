"""Static verification of ad-hoc Mach-O page hashes and sealed resource hashes.
This does not replace Apple's codesign/spctl checks on macOS.
"""
from pathlib import Path
import hashlib, math, os, plistlib, struct, sys
root=Path(sys.argv[1]);binaries=0;resources=0

def digest(data,kind,size):
    algorithms={1:'sha1',2:'sha256',3:'sha256',4:'sha384'}
    assert kind in algorithms, f'Unsupported digest {kind}'
    return hashlib.new(algorithms[kind],data).digest()[:size]

for path in root.rglob('*'):
    if path.is_symlink() or not path.is_file(): continue
    with path.open('rb') as reader: head=reader.read(32)
    if head[:4]!=b'\xcf\xfa\xed\xfe': continue
    data=path.read_bytes();cpu=struct.unpack_from('<I',data,4)[0]
    assert cpu==0x100000c, f'Not arm64: {path}'
    ncmds=struct.unpack_from('<I',data,16)[0];offset=32;signature=None
    for _ in range(ncmds):
        command,size=struct.unpack_from('<II',data,offset)
        if command==0x1d: signature=struct.unpack_from('<II',data,offset+8)
        assert size>=8;offset+=size
    assert signature, f'Missing signature: {path}'
    start,length=signature;blob=data[start:start+length]
    magic,total,count=struct.unpack_from('>III',blob)
    assert magic==0xfade0cc0 and total<=len(blob)
    slots={}
    for i in range(count):
        slot,at=struct.unpack_from('>II',blob,12+i*8);size=struct.unpack_from('>I',blob,at+4)[0];slots[slot]=blob[at:at+size]
    directories=[v for v in slots.values() if v[:4]==b'\xfa\xde\x0c\x02']
    assert directories
    for cd in directories:
        _,length,version,flags,hash_at,ident,special,number,limit=struct.unpack_from('>9I',cd)
        hash_size,hash_kind,platform,page=struct.unpack_from('4B',cd,36)
        assert flags&2, f'Expected ad-hoc signature: {path}'
        if limit==0xffffffff and version>=0x20300: limit=struct.unpack_from('>Q',cd,56)[0]
        chunk=1<<page if page else limit
        assert limit<=start and number==math.ceil(limit/chunk), str(path)
        for i in range(number):
            expected=cd[hash_at+i*hash_size:hash_at+(i+1)*hash_size]
            assert expected==digest(data[i*chunk:min((i+1)*chunk,limit)],hash_kind,hash_size), f'Bad code page: {path} {i}'
        for slot in (2,5,7):
            if slot in slots and slot<=special:
                assert cd[hash_at-slot*hash_size:hash_at-(slot-1)*hash_size]==digest(slots[slot],hash_kind,hash_size), f'Bad embedded slot: {path}'
        bundle=None
        for parent in path.parents:
            if parent.suffix=='.app': bundle=parent/'Contents';break
            if (parent/'Resources/Info.plist').exists() and (parent/'_CodeSignature/CodeResources').exists(): bundle=parent;break
        if bundle:
            for slot,source in [(1,bundle/'Info.plist' if (bundle/'Info.plist').exists() else bundle/'Resources/Info.plist'),(3,bundle/'_CodeSignature/CodeResources')]:
                if slot<=special and source.exists():
                    expected=cd[hash_at-slot*hash_size:hash_at-(slot-1)*hash_size]
                    if any(expected): assert expected==digest(source.read_bytes(),hash_kind,hash_size), f'Bad bundle metadata: {path} slot {slot}'
    binaries+=1
for manifest in root.rglob('CodeResources'):
    if manifest.parent.name!='_CodeSignature' or manifest.is_symlink(): continue
    base=manifest.parent.parent;records=plistlib.loads(manifest.read_bytes())
    for key in ('files','files2'):
        for name,record in records.get(key,{}).items():
            source=base/name
            if isinstance(record,bytes): record={'hash':record}
            if 'symlink' in record:
                assert source.is_symlink() and os.readlink(source)==record['symlink'], str(source)
            for hash_name,algorithm in [('hash','sha1'),('hash2','sha256')]:
                if hash_name in record:
                    assert source.exists() and hashlib.new(algorithm,source.read_bytes()).digest()==record[hash_name], f'Bad sealed resource: {source}'
                    resources+=1
assert binaries>0
print(f'Verified {binaries} arm64 Mach-O signatures and {resources} sealed resource hashes. Apple runtime checks remain pending.')
