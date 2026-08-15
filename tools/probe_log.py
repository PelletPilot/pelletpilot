import sys, time; sys.path.insert(0,'tools')
from pbclient import PitBoss
pb=PitBoss()
log=open('/tmp/claude-1000/-data-git-pitboss/c6935ecd-0f23-4a0a-8391-7f021bd5b57e/scratchpad/probe3.log','a')
start=time.time()
while time.time()-start < 360:  # ~6 minutes
    s=pb.get_state()
    line="t+%4ds set=%s chamber=%s probe3=%s auger=%s" % (
        int(time.time()-start), s.get('grill_set_temp'), s.get('grill_temp'),
        s.get('p3_temp'), s.get('motor_state'))
    print(line); log.write(line+"\n"); log.flush()
    time.sleep(20)
