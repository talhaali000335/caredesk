from django.db import migrations, models


def team_messages(apps, schema_editor):
    apps.get_model("core", "Message").objects.filter(sender="team").update(channel="team")


class Migration(migrations.Migration):

    dependencies = [
        ("core", "0002_business_look"),
    ]

    operations = [
        migrations.AddField(
            model_name="message",
            name="channel",
            field=models.CharField(default="bot", max_length=5),
        ),
        migrations.RunPython(team_messages, migrations.RunPython.noop),
    ]