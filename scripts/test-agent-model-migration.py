"""Migration acceptance on disposable PostgreSQL databases; never touches production.
Requires sentinel-model-test-db (postgres user postgres) listening on 127.0.0.1:55439.
"""
import io
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import time

root = Path(__file__).resolve().parents[1]
base = 'ba5b9abe64faf59d8604ef4748cd5c24dd1f21aa'

def sql(database, statement):
    return subprocess.check_output(['docker', 'exec', '-i', 'sentinel-model-test-db', 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], input=statement.encode()).decode().strip()

def deploy(database, schema):
    env = os.environ.copy()
    env['DATABASE_URL'] = f'postgresql://postgres:sentinel_test@127.0.0.1:55439/{database}'
    subprocess.run(['npx', 'prisma', 'migrate', 'deploy', '--schema', str(schema)], cwd=root, env=env, check=True)

with tempfile.TemporaryDirectory(prefix='sentinel-main-schema-') as directory:
    archive = subprocess.check_output(['git', 'archive', base, 'prisma'], cwd=root)
    with tarfile.open(fileobj=io.BytesIO(archive)) as tar:
        tar.extractall(directory, filter='data')
    for shape in ['fresh', 'main']:
        database = f'sentinel_migration_{shape}_{int(time.time())}'
        sql('postgres', f'CREATE DATABASE "{database}";')
        if shape == 'main':
            deploy(database, Path(directory) / 'prisma/schema.prisma')
            sql(database, '''
INSERT INTO agents (id,name,role,avatar,color,model) VALUES
 ('hermes-lisa','Lisa','assistant','x','#000000','old-lisa'),
 ('claude-code','Claude','assistant','x','#000000','old-claude'),
 ('codex','Codex','assistant','x','#000000','old-codex') ON CONFLICT (id) DO UPDATE SET model=EXCLUDED.model;
INSERT INTO agent_runtimes (id,"agentId",kind,transport,"updatedAt") VALUES ('runtime-hermes-clint','hermes-clint','hermes','docker',CURRENT_TIMESTAMP);
INSERT INTO agent_sessions (id,runtime,"runtimeInstanceId","agentId","userId",metadata) VALUES ('historical-clint','hermes','runtime-hermes-clint','hermes-clint','historical-user','{"requestedModel":"historical-model"}');
INSERT INTO agent_runtime_events (id,"sessionId",sequence,type,payload) VALUES ('historical-event','historical-clint',1,'completed','{"preserved":true}');
''')
        deploy(database, root / 'prisma/schema.prisma')
        assert sql(database, "SELECT model FROM agents WHERE id='hermes-nathan2'") == 'gpt-5.6-luna'
        assert sql(database, "SELECT count(*) FROM agent_runtimes WHERE id='runtime-hermes-nathan2'") == '1'
        if shape == 'main':
            assert sql(database, "SELECT enabled FROM agent_runtimes WHERE id='runtime-hermes-clint'") == 'f'
            assert sql(database, "SELECT metadata->>'requestedModel' FROM agent_sessions WHERE id='historical-clint'") == 'historical-model'
            assert sql(database, "SELECT count(*) FROM agent_runtime_events WHERE id='historical-event'") == '1'
            assert sql(database, "SELECT model || ':' || \"reasoningEffort\" FROM agents WHERE id='codex'") == 'gpt-6-astra:low'
            assert sql(database, "SELECT model || ':' || \"reasoningEffort\" FROM agents WHERE id='claude-code'") == 'claude-opus-5:low'
            sql(database, "UPDATE agents SET model='operator-model', \"reasoningEffort\"='high' WHERE id='codex'")
            deploy(database, root / 'prisma/schema.prisma')
            assert sql(database, "SELECT model FROM agents WHERE id='codex'") == 'operator-model'
        print(f'PASS {shape}: additive migration, canonical Nathan2, history and customizations preserved', flush=True)
